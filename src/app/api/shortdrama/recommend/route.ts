import { NextRequest, NextResponse } from 'next/server';
import '@/lib/server-cache';

import { SHORTDRAMA_CACHE_EXPIRE } from '@/lib/cache';
import { getRecommendedShortDramas } from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const size = searchParams.get('size');
    const pageSize = size ? parseInt(size) : 15;
    if (isNaN(pageSize)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }
    const result = await getRecommendedShortDramas(pageSize);
    // 测试1小时HTTP缓存策略
    const response = NextResponse.json(result);
    // 1小时 = 3600秒
    const cacheTime = SHORTDRAMA_CACHE_EXPIRE.recommends;
    response.headers.set(
      'Cache-Control',
      `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    );
    response.headers.set('CDN-Cache-Control', `public, s-maxage=${cacheTime}`);
    response.headers.set(
      'Vercel-CDN-Cache-Control',
      `public, s-maxage=${cacheTime}`,
    );

    // Vary头确保不同设备有不同缓存
    response.headers.set('Vary', 'Accept-Encoding, User-Agent');

    return response;
  } catch (error) {
    console.error('获取推荐短剧失败:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
