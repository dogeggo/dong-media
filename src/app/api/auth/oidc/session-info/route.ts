import { NextRequest, NextResponse } from 'next/server';

import { noStoreResponseHeaders } from '@/lib/cache-system';
import { unsealSession } from '@/lib/sealed-session';

export const runtime = 'nodejs';

interface OidcRegistrationSession {
  email?: string;
  name?: string;
  trust_level?: number;
  timestamp: number;
}

export async function GET(request: NextRequest) {
  const secret = process.env.PASSWORD;
  const cookie = request.cookies.get('oidc_session')?.value;
  const session =
    secret && cookie
      ? unsealSession<OidcRegistrationSession>(
          cookie,
          'oidc-registration',
          secret,
        )
      : null;

  if (
    !session ||
    !Number.isSafeInteger(session.timestamp) ||
    Date.now() - session.timestamp > 600_000 ||
    Date.now() < session.timestamp - 300_000
  ) {
    return NextResponse.json(
      { error: 'OIDC会话不存在或已过期' },
      {
        status: 404,
        headers: noStoreResponseHeaders({
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        }),
      },
    );
  }

  return NextResponse.json(
    {
      email: session.email,
      name: session.name,
      trust_level: session.trust_level,
    },
    {
      headers: noStoreResponseHeaders({
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      }),
    },
  );
}
