import { NextRequest, NextResponse } from 'next/server';

import { loadConfig } from '@/lib/config';
import { verifyMediaUrlSignature } from '@/lib/media-signature';
import {
  isExecutableDocumentContentType,
  safeFetch,
  UnsafeUpstreamUrlError,
} from '@/lib/safe-upstream-url';

export const runtime = 'nodejs';

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
      scope: 'segment',
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const range = request.headers.get('range');
    const response = await safeFetch(url, {
      maxRedirects: 5,
      signal: controller.signal,
      headers: {
        'User-Agent': liveSource.ua || 'AptvPlayer/1.4.10',
        Accept: 'video/*, audio/*, application/octet-stream, */*',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        ...(range ? { Range: range } : {}),
      },
    });

    if (!response.ok) {
      await response.body?.cancel();
      return NextResponse.json(
        {
          error: `Upstream segment request failed with status ${response.status}`,
        },
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

    const headers = new Headers({
      'Content-Type': contentType || 'application/octet-stream',
      'Accept-Ranges': response.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    for (const name of [
      'content-length',
      'content-range',
      'etag',
      'last-modified',
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(
      response.body as unknown as ReadableStream<Uint8Array>,
      { status: response.status, headers },
    );
  } catch (error) {
    if (error instanceof UnsafeUpstreamUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Segment request timed out' },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: 'Segment proxy failed' },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
