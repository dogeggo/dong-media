import { NextResponse } from 'next/server';

import { normalizeAdFilterConfig } from '@/lib/ad-filter';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json(
      normalizeAdFilterConfig(config.SiteConfig.AdFilterConfig),
      {
        headers: noStoreResponseHeaders({
          'X-Content-Type-Options': 'nosniff',
        }),
      },
    );
  } catch {
    return NextResponse.json(
      { error: '获取去广告配置失败' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
