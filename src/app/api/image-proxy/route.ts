import { NextResponse } from 'next/server';

import {
  conditionalResponseHeaders,
  noStoreResponseHeaders,
  staticMediaResponseHeaders,
} from '@/lib/cache-system/http';
import { imageDiskCache } from '@/lib/cache-system/media/disk';
import {
  createMediaEtag,
  hasFailedPreconditions,
  hasSensitiveMediaParams,
  isAllowedMediaContentType,
  isNotModified,
  mediaBody,
  normalizeMediaContentType,
  readBodyWithLimit,
} from '@/lib/cache-system/media/policy';
import {
  fetchDoubanWithAntiScraping,
  isDoubanUrl,
} from '@/lib/douban-challenge';
import {
  parseSafeHttpUrl,
  safeFetch,
  UnsafeUpstreamUrlError,
} from '@/lib/safe-upstream-url';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

class ImageProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function GET(request: Request) {
  const imageUrl = new URL(request.url).searchParams.get('url');
  if (!imageUrl) return errorResponse('Missing image URL', 400);

  let parsed: URL;
  try {
    parsed = parseSafeHttpUrl(imageUrl);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Invalid image URL',
      400,
    );
  }

  try {
    if (hasSensitiveMediaParams(parsed)) {
      const payload = await fetchImage(parsed);
      let headers = noStoreResponseHeaders({
        'Content-Type': payload.contentType,
        'Content-Length': String(payload.data.byteLength),
        'Access-Control-Allow-Origin': '*',
        'X-Cache-Status': 'BYPASS',
        'X-Content-Type-Options': 'nosniff',
      });
      const metadata = {
        etag: payload.etag || createMediaEtag(payload.data),
        lastModified: payload.lastModified,
      };
      headers = conditionalResponseHeaders(metadata, headers);
      if (hasFailedPreconditions(request, metadata)) {
        headers.delete('Content-Length');
        return new Response(null, { status: 412, headers });
      }
      if (isNotModified(request, metadata)) {
        headers.delete('Content-Length');
        return new Response(null, { status: 304, headers });
      }
      return new Response(mediaBody(payload.data), { status: 200, headers });
    }

    const object = await imageDiskCache.getOrCreate(
      parsed.toString(),
      'original',
      () => fetchImage(parsed),
    );

    let headers = staticMediaResponseHeaders(
      {
        contentAddressed: false,
        ttlSeconds: remainingTtlSeconds(object.metadata.expiresAt),
      },
      {
        'Content-Type': object.metadata.contentType,
        'Content-Length': String(object.metadata.size),
        'Access-Control-Allow-Origin': '*',
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
    return new Response(mediaBody(object.data), { status: 200, headers });
  } catch (error) {
    if (error instanceof ImageProxyError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof UnsafeUpstreamUrlError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return errorResponse('Image fetch timed out', 504);
    }
    return errorResponse('Failed to fetch image', 502);
  }
}

async function fetchImage(parsed: URL) {
  const headers = {
    Referer: `${parsed.origin}/`,
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
  };
  const response = isDoubanUrl(parsed.toString())
    ? await fetchDoubanWithAntiScraping(parsed.toString(), {
        timeoutMs: 15_000,
        headers,
      })
    : await safeFetch(parsed.toString(), {
        maxRedirects: 5,
        signal: AbortSignal.timeout(15_000),
        headers,
      });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImageProxyError(
      `Image upstream returned ${response.status}`,
      response.status,
    );
  }
  const contentType = response.headers.get('content-type');
  if (!isAllowedMediaContentType('image', contentType)) {
    await response.body?.cancel();
    throw new ImageProxyError('Unsupported image content type', 415);
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new ImageProxyError('Image is too large', 413);
  }
  let data: Uint8Array;
  try {
    data = await readBodyWithLimit(response, MAX_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ImageProxyError('Image is too large', 413);
    }
    throw error;
  }
  if (!data.byteLength) throw new ImageProxyError('Image is empty', 502);
  console.log(`图片代理拉取. url = ${parsed.toString()}`);
  return {
    data,
    contentType: normalizeMediaContentType(contentType),
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: noStoreResponseHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since',
    }),
  });
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
