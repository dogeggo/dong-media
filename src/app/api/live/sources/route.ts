/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const config = await loadConfig();

    if (!config) {
      return NextResponse.json({ error: '配置未找到' }, { status: 404 });
    }

    // 过滤出所有非 disabled 的直播源
    const liveSources = (config.LiveConfig || []).filter(
      (source) => !source.disabled,
    );

    return NextResponse.json(
      { success: true, data: liveSources },
      { headers: noStoreResponseHeaders() },
    );
  } catch (error) {
    console.error('获取直播源失败:', error);
    return NextResponse.json(
      { error: '获取直播源失败' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
