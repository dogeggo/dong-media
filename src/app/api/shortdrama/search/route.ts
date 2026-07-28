import { NextRequest, NextResponse } from 'next/server';
import '@/lib/server-cache';

import { SEARCH_CACHE_EXPIRE } from '@/lib/cache';
import { searchShortDramas } from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get('query');
    const page = searchParams.get('page');

    if (!query) {
      return NextResponse.json(
        { error: '缺少必要参数: query' },
        { status: 400 },
      );
    }

    const pageNum = page ? parseInt(page) : 1;

    if (isNaN(pageNum)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }
    const result = await searchShortDramas(query, pageNum);
    // 设置与网页端一致的缓存策略（搜索结果: 1小时）
    const response = NextResponse.json(result);
    // 1小时 = 3600秒（搜索结果更新频繁，短期缓存）
    const cacheTime = SEARCH_CACHE_EXPIRE;
    response.headers.set(
      'Cache-Control',
      `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    );
    response.headers.set('CDN-Cache-Control', `public, s-maxage=${cacheTime}`);
    response.headers.set(
      'Vercel-CDN-Cache-Control',
      `public, s-maxage=${cacheTime}`,
    );

    // 调试信息
    response.headers.set('X-Cache-Duration', '1hour');
    response.headers.set(
      'X-Cache-Expires-At',
      new Date(Date.now() + cacheTime * 1000).toISOString(),
    );
    response.headers.set('X-Debug-Timestamp', new Date().toISOString());

    // Vary头确保不同设备有不同缓存
    response.headers.set('Vary', 'Accept-Encoding, User-Agent');

    return response;
  } catch (error) {
    console.error('搜索短剧失败:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
