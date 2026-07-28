import { NextRequest, NextResponse } from 'next/server';
import '@/lib/server-cache';

import { SHORTDRAMA_CACHE_EXPIRE } from '@/lib/cache';
import { getShortDramaList } from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const categoryId = searchParams.get('categoryId');
    const page = searchParams.get('page');

    if (!categoryId) {
      return NextResponse.json(
        { error: '缺少必要参数: categoryId' },
        { status: 400 },
      );
    }

    const category = parseInt(categoryId);
    const pageNum = page ? parseInt(page) : 1;

    if (isNaN(category) || isNaN(pageNum)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }
    const result = await getShortDramaList(category, pageNum);

    const response = NextResponse.json(result);

    const cacheTime =
      pageNum === 1
        ? SHORTDRAMA_CACHE_EXPIRE.lists * 2
        : SHORTDRAMA_CACHE_EXPIRE.lists;
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
    response.headers.set('X-Cache-Duration', '2hour');
    response.headers.set(
      'X-Cache-Expires-At',
      new Date(Date.now() + cacheTime * 1000).toISOString(),
    );
    response.headers.set('X-Debug-Timestamp', new Date().toISOString());

    // Vary头确保不同设备有不同缓存
    response.headers.set('Vary', 'Accept-Encoding, User-Agent');

    return response;
  } catch (error) {
    console.error('获取短剧列表失败:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
