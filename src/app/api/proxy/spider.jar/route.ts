import { NextRequest, NextResponse } from 'next/server';

import {
  noStoreResponseHeaders,
  privateResponseHeaders,
} from '@/lib/cache-system';
import { authenticateRequest } from '@/lib/request-auth';
import { getSpiderJar } from '@/lib/spiderJar';

export const runtime = 'nodejs';

async function serveSpiderJar(request: NextRequest, includeBody: boolean) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: noStoreResponseHeaders() },
    );
  }

  try {
    const jarInfo = await getSpiderJar(false);
    return new NextResponse(
      includeBody ? new Uint8Array(jarInfo.buffer) : null,
      {
        headers: privateResponseHeaders(3600, {
          'Content-Type': 'application/java-archive',
          'Content-Length': String(jarInfo.size),
          'Content-Disposition': 'attachment; filename="dong-media-spider.jar"',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
          Digest: `sha-256=${Buffer.from(jarInfo.sha256, 'hex').toString('base64')}`,
        }),
      },
    );
  } catch {
    return NextResponse.json(
      { error: 'Verified spider JAR is temporarily unavailable' },
      { status: 503, headers: noStoreResponseHeaders() },
    );
  }
}

export async function GET(request: NextRequest) {
  return serveSpiderJar(request, true);
}

export async function HEAD(request: NextRequest) {
  return serveSpiderJar(request, false);
}
