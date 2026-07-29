import { NextRequest, NextResponse } from 'next/server';

import { noStoreResponseHeaders } from '@/lib/cache-system';
import { authenticateRequest } from '@/lib/request-auth';
import {
  isExecutableDocumentContentType,
  safeFetch,
  UnsafeUpstreamUrlError,
} from '@/lib/safe-upstream-url';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

export const runtime = 'nodejs';

async function proxyMedia(request: NextRequest, method: 'GET' | 'HEAD') {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targetUrl = request.nextUrl.searchParams.get('url');
  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const range = request.headers.get('range');
    const response = await safeFetch(targetUrl, {
      method,
      cache: 'no-store',
      maxRedirects: 5,
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept:
          'video/*, audio/*, application/octet-stream, application/vnd.apple.mpegurl, application/x-mpegurl, */*',
        'Accept-Encoding': 'identity',
        ...(range ? { Range: range } : {}),
      },
    });

    if (!response.ok) {
      await response.body?.cancel();
      return NextResponse.json(
        { error: `Upstream request failed with status ${response.status}` },
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

    const headers = noStoreResponseHeaders({
      'Content-Type': contentType || 'application/octet-stream',
      'Accept-Ranges': response.headers.get('accept-ranges') || 'bytes',
      'Content-Security-Policy': "default-src 'none'; sandbox",
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

    return new NextResponse(
      method === 'HEAD' ? null : (response.body as unknown as BodyInit),
      {
        status: response.status,
        headers,
      },
    );
  } catch (error) {
    if (error instanceof UnsafeUpstreamUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Upstream request timed out' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Media proxy failed' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  return proxyMedia(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return proxyMedia(request, 'HEAD');
}
