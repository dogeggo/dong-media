import { NextRequest, NextResponse } from 'next/server';

import { getCachedBangumiData } from '@/lib/bangumi-server';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { authenticateRequest } from '@/lib/request-auth';

/**
 * Bangumi API 代理路由
 * 解决客户端直接调用 Bangumi API 可能遇到的 CORS 问题
 *
 * 用法:
 * GET /api/proxy/bangumi?path=calendar
 * GET /api/proxy/bangumi?path=v0/subjects/12345
 */
export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (!path) {
    return NextResponse.json(
      { error: 'Missing path parameter' },
      { status: 400 },
    );
  }

  if (
    path.includes('..') ||
    path.startsWith('/') ||
    !/^[a-zA-Z0-9_/?=&.-]+$/.test(path)
  ) {
    return NextResponse.json(
      { error: 'Invalid path parameter' },
      { status: 400 },
    );
  }

  try {
    const cached = await getCachedBangumiData(path);
    return NextResponse.json(cached.value, {
      headers: noStoreResponseHeaders({
        'Server-Timing': `cache;desc="${cached.status}"`,
        'X-Cache-Status': cached.status,
        'X-Content-Type-Options': 'nosniff',
      }),
    });
  } catch (error) {
    console.error('Bangumi API proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Bangumi API' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
