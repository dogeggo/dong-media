import { NextResponse } from 'next/server';

import { normalizeAdFilterConfig } from '@/lib/ad-filter';
import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json(
      normalizeAdFilterConfig(config.SiteConfig.AdFilterConfig),
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch {
    return NextResponse.json({ error: '获取去广告配置失败' }, { status: 500 });
  }
}
