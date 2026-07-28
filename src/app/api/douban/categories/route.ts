import { NextResponse } from 'next/server';
import '@/lib/server-cache';

import { DOUBAN_CACHE_EXPIRE } from '@/lib/cache';
import { getDoubanCategories } from '@/lib/douban-api';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = request.url;

  // 获取参数
  const kind = searchParams.get('kind');
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 },
    );
  }

  if (kind !== 'tv' && kind !== 'movie') {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }

  if (pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 },
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 },
    );
  }
  try {
    const result: DoubanResult = await getDoubanCategories({
      kind,
      category,
      type,
      pageLimit,
      pageStart,
    });

    const cacheTime = DOUBAN_CACHE_EXPIRE.categories;
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    console.error(`[豆瓣分类] 请求失败: ${target}`, (error as Error).message);
    return NextResponse.json(
      {
        error: '获取豆瓣数据失败',
        details: (error as Error).message,
        url: target,
        params: { kind, category, type, pageLimit, pageStart },
      },
      { status: 500 },
    );
  }
}
