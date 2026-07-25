import type { NextRequest } from 'next/server';

export function normalizeSiteOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SITE_BASE must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('SITE_BASE must not contain credentials');
  }
  return url.origin;
}

export function getSiteOrigin(request: NextRequest): string {
  const configured = process.env.SITE_BASE?.trim();
  if (configured) return normalizeSiteOrigin(configured);

  const origin = request.nextUrl.origin.replace('://0.0.0.0:', '://localhost:');
  return normalizeSiteOrigin(origin);
}
