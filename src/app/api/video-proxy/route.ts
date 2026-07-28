import fs from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import stream from 'stream';
import { promisify } from 'util';
import '@/lib/server-cache';

import { getCacheTime } from '@/lib/config';
import { fetchTrailerWithRetry } from '@/lib/douban-api';
import {
  fetchDoubanWithAntiScraping,
  isDoubanUrl,
} from '@/lib/douban-challenge';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

const pipeline = promisify(stream.pipeline);
const CACHE_DIR = path.resolve('/app/cache/video');
const MAX_CACHE_BYTES = 10 * 1024 * 1024;
const downloadingFiles = new Set<string>();

// Ensure cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (e) {
  console.error('Failed to create cache dir', e);
}

export const runtime = 'nodejs';

// 视频代理接口 - 支持流式传输和Range请求
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let videoUrl = searchParams.get('url');
  const doubanId = searchParams.get('id');
  const isCarousel = searchParams.get('carousel') === '1';

  if (isCarousel && !doubanId) {
    return NextResponse.json({ error: 'Missing video ID' }, { status: 400 });
  }

  if (isCarousel) {
    videoUrl = null;
    try {
      videoUrl = (await fetchTrailerWithRetry(doubanId)).trailerUrl;
    } catch (e) {
      console.error(
        `[Video Proxy] Failed to fetch trailer for ${doubanId}:`,
        e,
      );
    }
  }

  if (!videoUrl) {
    return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
  }

  // URL 格式验证
  try {
    new URL(videoUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  try {
    // 构建请求头
    const fetchHeaders: HeadersInit = {
      Accept:
        'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity;q=1, *;q=0',
      Connection: 'keep-alive',
    };

    // --- 本地缓存逻辑 ---
    // 仅针对轮播视频进行缓存和完整返回
    let cacheMiss = false;
    if (isCarousel) {
      // 提取文件名：从 URL 路径中获取最后一部分
      const urlPath = new URL(videoUrl).pathname;
      const filename = path.basename(urlPath); // 例如 "703230195.mp4"
      const filePath = path.join(CACHE_DIR, filename);

      if (fs.existsSync(filePath)) {
        console.log(`[Video Cache] HIT: ${filename}`);
        try {
          // 强制返回完整文件
          return serveLocalFile(request, filePath);
        } catch (e) {
          console.error('[Video Cache] Error serving local file:', e);
          cacheMiss = true;
        }
      } else {
        // 触发后台下载（不带 Range 头）
        console.log(`[Video Cache] MISS: ${filename}`);
        cacheMiss = true;
        if (!downloadingFiles.has(filename)) {
          downloadingFiles.add(filename);
          const downloadHeaders = { ...fetchHeaders };
          downloadToCache(videoUrl, filePath, downloadHeaders, MAX_CACHE_BYTES)
            .catch((err) =>
              console.error('[Video Cache] Background download failed:', err),
            )
            .finally(() => downloadingFiles.delete(filename));
        }
      }
    }

    // 如果客户端发送了 Range 请求，转发给目标服务器
    if (cacheMiss) {
      const warmingResponse = NextResponse.json(
        { error: 'Video cache warming' },
        { status: 503 },
      );
      warmingResponse.headers.set('Access-Control-Allow-Origin', '*');
      warmingResponse.headers.set(
        'Cache-Control',
        'no-cache, no-store, must-revalidate',
      );
      warmingResponse.headers.set('Retry-After', '5');
      warmingResponse.headers.set('X-Cache-Status', 'WARMING');
      return warmingResponse;
    }

    // 获取客户端的 Range 请求头
    const rangeHeader = request.headers.get('range');
    // 获取条件请求头（用于缓存重验证）
    const ifNoneMatch = request.headers.get('if-none-match');
    const ifModifiedSince = request.headers.get('if-modified-since');
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    // 转发条件请求头（用于缓存重验证）
    if (ifNoneMatch) {
      fetchHeaders['If-None-Match'] = ifNoneMatch;
    }
    if (ifModifiedSince) {
      fetchHeaders['If-Modified-Since'] = ifModifiedSince;
    }

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const videoResponse = await fetch(videoUrl, {
      signal: controller.signal,
      headers: fetchHeaders,
    });

    clearTimeout(timeoutId);

    // 处理 304 Not Modified（缓存重验证成功）
    if (videoResponse.status === 304) {
      const headers = new Headers();
      const etag = videoResponse.headers.get('etag');
      const lastModified = videoResponse.headers.get('last-modified');
      if (etag) headers.set('ETag', etag);
      if (lastModified) headers.set('Last-Modified', lastModified);
      const cacheTime = await getCacheTime();
      headers.set(
        'Cache-Control',
        `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
      );
      headers.set('Access-Control-Allow-Origin', '*');

      return new Response(null, {
        status: 304,
        headers,
      });
    }

    if (!videoResponse.ok) {
      const errorResponse = NextResponse.json(
        {
          error: 'Failed to fetch video',
          status: videoResponse.status,
          statusText: videoResponse.statusText,
        },
        { status: videoResponse.status },
      );
      // 错误响应不缓存，避免缓存失效的视频链接
      errorResponse.headers.set(
        'Cache-Control',
        'no-cache, no-store, must-revalidate',
      );
      return errorResponse;
    }

    if (!videoResponse.body) {
      return NextResponse.json(
        { error: 'Video response has no body' },
        { status: 500 },
      );
    }

    const contentType = videoResponse.headers.get('content-type');
    const contentLength = videoResponse.headers.get('content-length');
    const contentRange = videoResponse.headers.get('content-range');
    const acceptRanges = videoResponse.headers.get('accept-ranges');
    const etag = videoResponse.headers.get('etag');
    const lastModified = videoResponse.headers.get('last-modified');

    // 创建响应头
    const headers = new Headers();
    if (contentType) headers.set('Content-Type', contentType);
    if (contentLength) headers.set('Content-Length', contentLength);
    if (contentRange) headers.set('Content-Range', contentRange);
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
    if (etag) headers.set('ETag', etag);
    if (lastModified) headers.set('Last-Modified', lastModified);
    const cacheTime = await getCacheTime();
    headers.set(
      'Cache-Control',
      `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    );
    // 添加 CORS 支持
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range');

    // 返回正确的状态码：Range请求返回206，完整请求返回200
    const statusCode = rangeHeader && contentRange ? 206 : 200;

    // 直接返回视频流
    return new Response(videoResponse.body, {
      status: statusCode,
      headers,
    });
  } catch (error: any) {
    // 错误类型判断
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Video fetch timeout (30s)' },
        { status: 504 },
      );
    }
    console.error('[Video Proxy] Error fetching video:', error.message);
    return NextResponse.json(
      { error: 'Error fetching video', details: error.message },
      { status: 500 },
    );
  }
}

// 处理 HEAD 请求（用于获取视频元数据）
export async function HEAD(request: Request) {
  const { searchParams } = new URL(request.url);
  let videoUrl = searchParams.get('url');
  const doubanId = searchParams.get('id');
  const isCarousel = searchParams.get('carousel') === '1';

  if (isCarousel && !doubanId) {
    return new NextResponse(null, { status: 400 });
  }

  if (isCarousel) {
    videoUrl = null;
    try {
      videoUrl = (await fetchTrailerWithRetry(doubanId)).trailerUrl;
    } catch (e) {
      console.error(
        `[Video Proxy] Failed to fetch trailer for ${doubanId}:`,
        e,
      );
    }
  }

  if (!videoUrl) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    if (isCarousel) {
      const urlPath = new URL(videoUrl).pathname;
      const filename = path.basename(urlPath);
      const filePath = path.join(CACHE_DIR, filename);

      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtime.toUTCString();
        const etag = `"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;

        const headers = new Headers();
        headers.set('Content-Type', 'video/mp4');
        headers.set('Content-Length', stat.size.toString());
        headers.set('ETag', etag);
        headers.set('Last-Modified', mtime);
        headers.set('Access-Control-Allow-Origin', '*');
        const cacheTime = await getCacheTime();
        headers.set(
          'Cache-Control',
          `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        );
        headers.set('X-Cache-Status', 'HIT');

        return new NextResponse(null, { status: 200, headers });
      }

      const warmingResponse = new NextResponse(null, { status: 503 });
      warmingResponse.headers.set('Access-Control-Allow-Origin', '*');
      warmingResponse.headers.set(
        'Cache-Control',
        'no-cache, no-store, must-revalidate',
      );
      warmingResponse.headers.set('Retry-After', '5');
      warmingResponse.headers.set('X-Cache-Status', 'WARMING');
      return warmingResponse;
    }

    // 动态设置 Referer 和 Origin（根据视频源域名）
    const videoUrlObj = new URL(videoUrl);
    const sourceOrigin = `${videoUrlObj.protocol}//${videoUrlObj.host}`;

    // 针对豆瓣的特殊处理
    let referer = sourceOrigin + '/';
    if (videoUrl.includes('douban')) {
      referer = 'https://movie.douban.com/';
    }

    const videoResponse = await fetch(videoUrl, {
      method: 'HEAD',
      headers: {
        Referer: referer,
        Origin: sourceOrigin,
        'User-Agent': DEFAULT_USER_AGENT,
        Accept:
          'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity;q=1, *;q=0',
        Connection: 'keep-alive',
      },
    });

    const headers = new Headers();
    const contentType = videoResponse.headers.get('content-type');
    const contentLength = videoResponse.headers.get('content-length');
    const acceptRanges = videoResponse.headers.get('accept-ranges');
    const etag = videoResponse.headers.get('etag');
    const lastModified = videoResponse.headers.get('last-modified');

    if (contentType) headers.set('Content-Type', contentType);
    if (contentLength) headers.set('Content-Length', contentLength);
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
    if (etag) headers.set('ETag', etag);
    if (lastModified) headers.set('Last-Modified', lastModified);
    headers.set('Access-Control-Allow-Origin', '*');
    const cacheTime = await getCacheTime();
    headers.set(
      'Cache-Control',
      `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    );
    return new NextResponse(null, {
      status: videoResponse.status,
      headers,
    });
  } catch (error: any) {
    console.error('[Video Proxy] HEAD request error:', error.message);
    return new NextResponse(null, { status: 500 });
  }
}

// 处理 CORS 预检请求
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    },
  });
}

// 辅助函数：后台下载视频到缓存
async function downloadToCache(
  url: string,
  filePath: string,
  headers: any,
  maxBytes: number,
) {
  const tempPath = `${filePath}.tmp`;
  const controller = new AbortController();
  try {
    const cappedHeaders = { ...headers, Range: `bytes=0-${maxBytes - 1}` };
    const response = isDoubanUrl(url)
      ? await fetchDoubanWithAntiScraping(url, {
          headers: cappedHeaders,
          signal: controller.signal,
          timeoutMs: 60000,
        })
      : await fetch(url, {
          headers: cappedHeaders,
          signal: controller.signal,
        });
    if (!response.ok || !response.body) {
      console.error(
        `[Video Cache] Failed to fetch source: ${response.status}, url = ${url}`,
      );
      return;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml+xml')
    ) {
      console.error(
        `[Video Cache] Unexpected HTML response, skip caching: ${url}`,
      );
      return;
    }

    const contentLengthHeader = response.headers.get('content-length');
    const contentRangeHeader = response.headers.get('content-range');
    let totalSize: number | null = null;
    let isComplete = false;

    if (response.status === 206 && contentRangeHeader) {
      const match = contentRangeHeader.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
      if (match && match[3] !== '*') {
        const start = Number(match[1]);
        const end = Number(match[2]);
        const total = Number(match[3]);
        if (Number.isFinite(total)) {
          totalSize = total;
          isComplete = start === 0 && end + 1 === total;
        }
      }
    } else if (response.status === 200 && contentLengthHeader) {
      const total = Number(contentLengthHeader);
      if (Number.isFinite(total)) {
        totalSize = total;
        isComplete = true;
      }
    }

    let isPartial = false;
    if (totalSize === null) {
      isPartial = true;
      console.log(
        `[Video Cache] Size unknown, caching up to ${maxBytes}: ${url}`,
      );
    } else if (totalSize > maxBytes) {
      isPartial = true;
      console.log(
        `[Video Cache] Capping cache (too large: ${totalSize}): ${url}`,
      );
    } else if (!isComplete) {
      isPartial = true;
      console.log(`[Video Cache] Capping cache (partial range): ${url}`);
    }

    const fileStream = fs.createWriteStream(tempPath);
    // @ts-ignore
    const reader = stream.Readable.fromWeb(response.body);
    let bytesWritten = 0;
    let limitReached = false;
    const limitTransform = new stream.Transform({
      transform(chunk, _encoding, callback) {
        if (limitReached) {
          callback();
          return;
        }

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxBytes - bytesWritten;

        if (remaining <= 0) {
          limitReached = true;
          controller.abort();
          callback();
          return;
        }

        let output = buffer;
        if (buffer.length > remaining) {
          output = buffer.subarray(0, remaining);
          limitReached = true;
        }

        bytesWritten += output.length;
        if (output.length > 0) {
          this.push(output);
        }

        if (limitReached) {
          controller.abort();
        }
        callback();
      },
    });

    try {
      await pipeline(reader, limitTransform, fileStream);
    } catch (error: any) {
      if (!(limitReached && error?.name === 'AbortError')) {
        throw error;
      }
    }

    // 等待文件流完全关闭
    fileStream.close();

    if (limitReached && !isPartial) {
      isPartial = true;
      console.log(`[Video Cache] Capping cache (exceeded limit): ${url}`);
    }

    // 简单的重试机制，确保文件句柄释放
    let retries = 3;
    while (retries > 0) {
      try {
        const cacheNote = isPartial ? ' (partial)' : '';
        console.log(
          `[VideoCache] Successfully cached${cacheNote}: ${filePath}`,
        );
        fs.renameSync(tempPath, filePath);
        break;
      } catch (e: any) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          throw e;
        }
      }
    }
  } catch (error) {
    console.error(`[Video Cache] Download error:`, error);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

// 辅助函数：服务本地缓存文件 (始终返回完整文件)
function serveLocalFile(request: Request, filePath: string) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const mtime = stat.mtime.toUTCString();
  const etag = `"${fileSize.toString(16)}-${stat.mtime.getTime().toString(16)}"`;

  // 检查缓存是否有效 (304 Not Modified)
  // 即使是完整文件请求，如果客户端发送了验证头，也应该支持 304
  const ifNoneMatch = request.headers.get('if-none-match');
  const ifModifiedSince = request.headers.get('if-modified-since');

  if (ifNoneMatch === etag || ifModifiedSince === mtime) {
    return new Response(null, {
      status: 304,
      headers: {
        'Cache-Control': 'public, max-age=604800, immutable',
        ETag: etag,
        'Last-Modified': mtime,
        'X-Cache-Status': 'HIT',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'video/mp4');
  headers.set('Content-Length', fileSize.toString());
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=604800, immutable');
  headers.set('X-Cache-Status', 'HIT');
  headers.set('ETag', etag);
  headers.set('Last-Modified', mtime);

  // 手动转换 Node Stream 到 Web Stream
  const streamToWeb = (nodeStream: fs.ReadStream) => {
    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => {
          try {
            controller.enqueue(chunk);
          } catch (e) {
            nodeStream.destroy();
          }
        });
        nodeStream.on('end', () => {
          try {
            controller.close();
          } catch (e) {}
        });
        nodeStream.on('error', (err) => {
          try {
            controller.error(err);
          } catch (e) {}
        });
      },
      cancel() {
        nodeStream.destroy();
      },
    });
  };

  const fileStream = fs.createReadStream(filePath);
  const webStream = streamToWeb(fileStream);

  return new Response(webStream, { status: 200, headers });
}
