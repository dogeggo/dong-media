import { NextRequest, NextResponse } from 'next/server';

import { authenticateRequest } from '@/lib/request-auth';
import { getSpiderJar } from '@/lib/spiderJar';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jarInfo = await getSpiderJar(false);
    return new NextResponse(new Uint8Array(jarInfo.buffer), {
      headers: {
        'Content-Type': 'application/java-archive',
        'Content-Length': String(jarInfo.size),
        'Content-Disposition': 'attachment; filename="dong-media-spider.jar"',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        Digest: `sha-256=${Buffer.from(jarInfo.sha256, 'hex').toString('base64')}`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Verified spider JAR is temporarily unavailable' },
      { status: 503 },
    );
  }
}
