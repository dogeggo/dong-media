import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  conditionalResponseHeaders,
  noStoreResponseHeaders,
  staticMediaResponseHeaders,
} from '@/lib/cache-system';
import {
  type MediaCacheObject,
  videoDiskCache,
} from '@/lib/cache-system/media/disk';
import {
  hasFailedPreconditions,
  hasSensitiveMediaParams,
  isAllowedMediaContentType,
  isIfRangeMatch,
  isNotModified,
  mediaBody,
  normalizeMediaContentType,
  parseSingleRange,
  readBodyWithLimit,
} from '@/lib/cache-system/media/policy';
import { fetchTrailerWithRetry } from '@/lib/douban-api';
import {
  parseSafeHttpUrl,
  safeFetch,
  UnsafeUpstreamUrlError,
  withResponseHeadersTimeout,
} from '@/lib/safe-upstream-url';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

export const runtime = 'nodejs';

const MAX_BUFFERED_VIDEO_BYTES = 100 * 1024 * 1024;

class VideoProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function GET(request: NextRequest) {
  const resolved = await resolveVideoUrl(request);
  if (resolved instanceof Response) return resolved;
  const { url, carousel, doubanId, cacheable } = resolved;

  try {
    if (!cacheable)
      return proxyUpstreamVideo(
        request,
        url,
        request.headers.get('range'),
        false,
      );

    const cached = await videoDiskCache.get(url);
    if (cached) return serveCachedVideo(request, cached, false);

    const range = request.headers.get('range');
    if (range) return proxyUpstreamVideo(request, url, range, true);

    const shouldStream = await isLargeVideo(url);
    if (shouldStream) return proxyUpstreamVideo(request, url, null, true);

    const object = await videoDiskCache.getOrCreate(url, 'original', () =>
      fetchCompleteVideo(url),
    );
    return serveCachedVideo(request, object, false);
  } catch (error) {
    if (carousel && doubanId && error instanceof VideoProxyError) {
      if (error.status === 403 || error.status === 404) {
        await invalidateExpiredTrailer(doubanId, url);
      }
    }
    return videoErrorResponse(error);
  }
}

export async function HEAD(request: NextRequest) {
  const resolved = await resolveVideoUrl(request);
  if (resolved instanceof Response) return resolved;
  const { url, carousel, doubanId, cacheable } = resolved;

  try {
    if (cacheable) {
      const cached = await videoDiskCache.get(url);
      if (cached) return serveCachedVideo(request, cached, true);
    }

    const requestHeaders = upstreamHeaders(url);
    copyConditionalRequestHeaders(request, requestHeaders, false);
    const response = await safeFetch(url, {
      method: 'HEAD',
      maxRedirects: 5,
      signal: AbortSignal.timeout(15_000),
      headers: requestHeaders,
    });
    if (response.status === 304) {
      let headers = cacheable
        ? staticMediaResponseHeaders(
            { contentAddressed: false },
            copyVideoHeaders(response.headers),
          )
        : noStoreResponseHeaders(copyVideoHeaders(response.headers));
      headers = conditionalResponseHeaders(
        {
          etag: response.headers.get('etag') || undefined,
          lastModified: response.headers.get('last-modified') || undefined,
        },
        headers,
      );
      headers.delete('Content-Length');
      return new NextResponse(null, { status: 304, headers });
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (
        carousel &&
        doubanId &&
        (response.status === 403 || response.status === 404)
      ) {
        await invalidateExpiredTrailer(doubanId, url);
      }
      return new NextResponse(null, {
        status: response.status,
        headers: noStoreResponseHeaders(),
      });
    }
    const contentType = response.headers.get('content-type');
    if (!isAllowedMediaContentType('video', contentType)) {
      await response.body?.cancel();
      return new NextResponse(null, {
        status: 415,
        headers: noStoreResponseHeaders(),
      });
    }
    let headers = cacheable
      ? staticMediaResponseHeaders(
          { contentAddressed: false },
          copyVideoHeaders(response.headers),
        )
      : noStoreResponseHeaders(copyVideoHeaders(response.headers));
    headers = conditionalResponseHeaders(
      {
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      },
      headers,
    );
    return new NextResponse(null, { status: 200, headers });
  } catch (error) {
    if (
      carousel &&
      doubanId &&
      error instanceof VideoProxyError &&
      (error.status === 403 || error.status === 404)
    ) {
      await invalidateExpiredTrailer(doubanId, url);
    }
    return videoErrorResponse(error, true);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: noStoreResponseHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers':
        'Range, Content-Type, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since, If-Range',
    }),
  });
}

async function resolveVideoUrl(request: NextRequest): Promise<
  | {
      url: string;
      carousel: boolean;
      doubanId: string | null;
      cacheable: boolean;
    }
  | Response
> {
  const carousel = request.nextUrl.searchParams.get('carousel') === '1';
  const doubanId = request.nextUrl.searchParams.get('id');
  let value = request.nextUrl.searchParams.get('url');

  if (carousel) {
    if (!doubanId || !/^\d{1,20}$/.test(doubanId)) {
      return errorResponse('Invalid video ID', 400);
    }
    try {
      const trailer = await cacheService.getOrLoad(
        CACHE_POLICIES.DOUBAN_TRAILER,
        { id: doubanId },
        () => fetchTrailerWithRetry(doubanId, 0, false),
        { isNegative: (result) => !result.trailerUrl },
      );
      if (!trailer.trailerUrl) {
        return errorResponse('Trailer is unavailable', 404);
      }
      value = trailer.trailerUrl;
    } catch {
      return errorResponse('Trailer is unavailable', 404);
    }
  }
  if (!value) return errorResponse('Missing video URL', 400);
  try {
    const parsed = parseSafeHttpUrl(value);
    return {
      url: parsed.toString(),
      carousel,
      doubanId,
      cacheable: !hasSensitiveMediaParams(parsed),
    };
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Invalid video URL',
      400,
    );
  }
}

async function fetchCompleteVideo(url: string) {
  const response = await safeFetch(url, {
    maxRedirects: 5,
    signal: AbortSignal.timeout(30_000),
    headers: upstreamHeaders(url),
  });
  if (!response.ok || response.status !== 200) {
    await response.body?.cancel();
    throw new VideoProxyError(
      `Video upstream returned ${response.status}`,
      response.status,
    );
  }
  const contentType = response.headers.get('content-type');
  if (!isAllowedMediaContentType('video', contentType)) {
    await response.body?.cancel();
    throw new VideoProxyError('Unsupported video content type', 415);
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_BUFFERED_VIDEO_BYTES
  ) {
    await response.body?.cancel();
    throw new VideoProxyError('Video is too large to buffer', 413);
  }
  let data: Uint8Array;
  try {
    data = await readBodyWithLimit(response, MAX_BUFFERED_VIDEO_BYTES);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new VideoProxyError('Video is too large to buffer', 413);
    }
    throw error;
  }
  if (!data.byteLength) throw new VideoProxyError('Video is empty', 502);
  return {
    data,
    contentType: normalizeMediaContentType(contentType),
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
  };
}

async function isLargeVideo(url: string): Promise<boolean> {
  try {
    const response = await safeFetch(url, {
      method: 'HEAD',
      maxRedirects: 5,
      signal: AbortSignal.timeout(10_000),
      headers: upstreamHeaders(url),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return true;
    }
    const rawLength = response.headers.get('content-length');
    const length = Number(rawLength);
    await response.body?.cancel();
    return (
      !rawLength ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > MAX_BUFFERED_VIDEO_BYTES
    );
  } catch {
    return true;
  }
}

async function proxyUpstreamVideo(
  request: NextRequest,
  url: string,
  range: string | null,
  cacheable: boolean,
) {
  const headers = upstreamHeaders(url);
  if (range) headers.set('Range', range);
  copyConditionalRequestHeaders(request, headers, Boolean(range));
  const response = await withResponseHeadersTimeout(
    (signal) =>
      safeFetch(url, {
        maxRedirects: 5,
        signal,
        headers,
      }),
    30_000,
    request.signal,
  );
  if (response.status === 304) {
    let responseHeaders = cacheable
      ? staticMediaResponseHeaders(
          { contentAddressed: false },
          copyVideoHeaders(response.headers),
        )
      : noStoreResponseHeaders(copyVideoHeaders(response.headers));
    responseHeaders = conditionalResponseHeaders(
      {
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      },
      responseHeaders,
    );
    responseHeaders.delete('Content-Length');
    return new Response(null, { status: 304, headers: responseHeaders });
  }
  if (response.status === 416) {
    await response.body?.cancel();
    return new Response(null, {
      status: 416,
      headers: noStoreResponseHeaders(copyVideoHeaders(response.headers)),
    });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new VideoProxyError(
      `Video upstream returned ${response.status}`,
      response.status,
    );
  }
  const contentType = response.headers.get('content-type');
  if (!isAllowedMediaContentType('video', contentType)) {
    await response.body?.cancel();
    throw new VideoProxyError('Unsupported video content type', 415);
  }
  let responseHeaders = cacheable
    ? staticMediaResponseHeaders(
        { contentAddressed: false },
        copyVideoHeaders(response.headers),
      )
    : noStoreResponseHeaders(copyVideoHeaders(response.headers));
  responseHeaders = conditionalResponseHeaders(
    {
      etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
    },
    responseHeaders,
  );
  return new Response(response.body as unknown as BodyInit, {
    status: response.status,
    headers: responseHeaders,
  });
}

function serveCachedVideo(
  request: NextRequest,
  object: MediaCacheObject,
  head: boolean,
) {
  let headers = staticMediaResponseHeaders(
    {
      contentAddressed: false,
      ttlSeconds: remainingTtlSeconds(object.metadata.expiresAt),
    },
    {
      'Content-Type': object.metadata.contentType,
      'Content-Length': String(object.metadata.size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'X-Cache-Status': object.status,
      'X-Content-Type-Options': 'nosniff',
    },
  );
  headers = conditionalResponseHeaders(
    {
      etag: object.metadata.etag,
      lastModified: object.metadata.lastModified,
    },
    headers,
  );
  if (hasFailedPreconditions(request, object.metadata)) {
    const failureHeaders = noStoreResponseHeaders(headers);
    failureHeaders.delete('Content-Length');
    return new Response(null, { status: 412, headers: failureHeaders });
  }
  if (isNotModified(request, object.metadata)) {
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }

  const requestedRange = head ? null : request.headers.get('range');
  const range = parseSingleRange(
    requestedRange && isIfRangeMatch(request, object.metadata)
      ? requestedRange
      : null,
    object.metadata.size,
  );
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: noStoreResponseHeaders({
        'Content-Range': `bytes */${object.metadata.size}`,
        'Accept-Ranges': 'bytes',
      }),
    });
  }
  if (range) {
    const length = range.end - range.start + 1;
    headers.set(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${object.metadata.size}`,
    );
    headers.set('Content-Length', String(length));
    return new Response(
      head ? null : mediaBody(object.data.subarray(range.start, range.end + 1)),
      { status: 206, headers },
    );
  }
  return new Response(head ? null : mediaBody(object.data), {
    status: 200,
    headers,
  });
}

function upstreamHeaders(url: string) {
  const parsed = new URL(url);
  return new Headers({
    Accept: 'video/webm,video/ogg,video/mp4,video/*;q=0.9',
    'Accept-Encoding': 'identity',
    Referer: `${parsed.origin}/`,
    Origin: parsed.origin,
    'User-Agent': DEFAULT_USER_AGENT,
  });
}

function copyConditionalRequestHeaders(
  request: Request,
  target: Headers,
  includeIfRange: boolean,
): void {
  for (const name of [
    'if-match',
    'if-none-match',
    'if-modified-since',
    'if-unmodified-since',
    ...(includeIfRange ? ['if-range'] : []),
  ]) {
    const value = request.headers.get(name);
    if (value) target.set(name, value);
  }
}

function copyVideoHeaders(source: { get(name: string): string | null }) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
  ]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function videoErrorResponse(error: unknown, head = false) {
  if (head) {
    const status = error instanceof VideoProxyError ? error.status : 502;
    return new NextResponse(null, {
      status,
      headers: noStoreResponseHeaders(),
    });
  }
  if (error instanceof VideoProxyError) {
    return errorResponse(error.message, error.status);
  }
  if (error instanceof UnsafeUpstreamUrlError) {
    return errorResponse(error.message, 400);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return errorResponse('Video request timed out', 504);
  }
  return errorResponse('Failed to fetch video', 502);
}

async function invalidateExpiredTrailer(
  doubanId: string,
  url: string,
): Promise<void> {
  await Promise.all([
    cacheService.delete(CACHE_POLICIES.DOUBAN_TRAILER, { id: doubanId }),
    videoDiskCache.delete(url),
  ]);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: noStoreResponseHeaders() },
  );
}

function remainingTtlSeconds(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000));
}
