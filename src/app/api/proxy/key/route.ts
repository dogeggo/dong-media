import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hashCacheValue,
  noStoreResponseHeaders,
  privateResponseHeaders,
} from '@/lib/cache-system';
import { mediaBody, readBodyWithLimit } from '@/lib/cache-system/media/policy';
import { loadConfig } from '@/lib/config';
import { verifyMediaUrlSignature } from '@/lib/media-signature';
import {
  isExecutableDocumentContentType,
  safeFetch,
  UnsafeUpstreamUrlError,
} from '@/lib/safe-upstream-url';

export const runtime = 'nodejs';

const MAX_KEY_SIZE = 1024 * 1024;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const source = request.nextUrl.searchParams.get('moontv-source');
  if (!url || !source) {
    return NextResponse.json(
      { error: 'Missing url or source' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (
    !verifyMediaUrlSignature({
      scope: 'key',
      source,
      url,
      expires: request.nextUrl.searchParams.get('expires'),
      signature: request.nextUrl.searchParams.get('signature'),
    })
  ) {
    return NextResponse.json(
      { error: 'Invalid or expired signature' },
      { status: 401, headers: noStoreResponseHeaders() },
    );
  }

  const config = await loadConfig();
  const liveSource = config.LiveConfig?.find(
    (candidate) => candidate.key === source && !candidate.disabled,
  );
  if (!liveSource) {
    return NextResponse.json(
      { error: 'Source not found' },
      { status: 404, headers: noStoreResponseHeaders() },
    );
  }

  try {
    const data = await cacheService.getOrLoad(
      CACHE_POLICIES.HLS_KEY,
      { source, target: hashCacheValue(url) },
      async () => {
        const response = await safeFetch(url, {
          maxRedirects: 5,
          signal: AbortSignal.timeout(10_000),
          headers: {
            'User-Agent': liveSource.ua || 'AptvPlayer/1.4.10',
            Accept: 'application/octet-stream, */*',
            'Cache-Control': 'no-cache',
          },
        });

        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Upstream key returned ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (isExecutableDocumentContentType(contentType)) {
          await response.body?.cancel();
          throw new TypeError('Executable document responses are not allowed');
        }

        const declaredLength = Number(
          response.headers.get('content-length') || 0,
        );
        if (declaredLength > MAX_KEY_SIZE) {
          await response.body?.cancel();
          throw new RangeError('Key response is too large');
        }

        return mediaBody(await readBodyWithLimit(response, MAX_KEY_SIZE));
      },
      { scope: source },
    );

    return new Response(data, {
      headers: privateResponseHeaders(CACHE_POLICIES.HLS_KEY.freshTtlSeconds, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      }),
    });
  } catch (error) {
    if (error instanceof UnsafeUpstreamUrlError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Key request timed out' },
        { status: 504, headers: noStoreResponseHeaders() },
      );
    }
    const status =
      error instanceof RangeError
        ? 413
        : error instanceof TypeError
          ? 415
          : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Key proxy failed' },
      { status, headers: noStoreResponseHeaders() },
    );
  }
}
