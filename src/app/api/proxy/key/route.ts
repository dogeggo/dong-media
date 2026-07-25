import { NextRequest, NextResponse } from 'next/server';

import { loadConfig } from '@/lib/config';
import { verifyMediaUrlSignature } from '@/lib/media-signature';
import {
  isExecutableDocumentContentType,
  safeFetch,
  UnsafeUpstreamUrlError,
} from '@/lib/safe-upstream-url';

export const runtime = 'nodejs';

const MAX_KEY_SIZE = 1024 * 1024;
const keyCache = new Map<string, { data: ArrayBuffer; expiresAt: number }>();

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const source = request.nextUrl.searchParams.get('moontv-source');
  if (!url || !source) {
    return NextResponse.json(
      { error: 'Missing url or source' },
      { status: 400 },
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
      { status: 401 },
    );
  }

  const config = await loadConfig();
  const liveSource = config.LiveConfig?.find(
    (candidate) => candidate.key === source && !candidate.disabled,
  );
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  const cacheKey = `${source}:${url}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(cached.data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'Content-Length': String(cached.data.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await safeFetch(url, {
      maxRedirects: 5,
      signal: controller.signal,
      headers: {
        'User-Agent': liveSource.ua || 'AptvPlayer/1.4.10',
        Accept: 'application/octet-stream, */*',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      await response.body?.cancel();
      return NextResponse.json(
        { error: `Upstream key request failed with status ${response.status}` },
        { status: response.status },
      );
    }

    const contentType = response.headers.get('content-type');
    if (isExecutableDocumentContentType(contentType)) {
      await response.body?.cancel();
      return NextResponse.json(
        { error: 'Executable document responses are not allowed' },
        { status: 415 },
      );
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_KEY_SIZE) {
      await response.body?.cancel();
      return NextResponse.json(
        { error: 'Key response is too large' },
        { status: 413 },
      );
    }

    const data = await response.arrayBuffer();
    if (data.byteLength > MAX_KEY_SIZE) {
      return NextResponse.json(
        { error: 'Key response is too large' },
        { status: 413 },
      );
    }
    keyCache.set(cacheKey, { data, expiresAt: Date.now() + 300_000 });
    if (keyCache.size > 200) {
      for (const [key, value] of keyCache) {
        if (value.expiresAt <= Date.now() || keyCache.size > 200)
          keyCache.delete(key);
      }
    }

    return new Response(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'Content-Length': String(data.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error) {
    if (error instanceof UnsafeUpstreamUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Key request timed out' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Key proxy failed' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
