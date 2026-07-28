/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import '@/lib/server-cache';

import { DOUBAN_CACHE_EXPIRE } from '@/lib/cache';
import { getDoubanRecommends } from '@/lib/douban-api';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // 获取参数
  const kind = searchParams.get('kind');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');
  const category =
    searchParams.get('category') === 'all' ? '' : searchParams.get('category');
  const format =
    searchParams.get('format') === 'all' ? '' : searchParams.get('format');
  const region =
    searchParams.get('region') === 'all' ? '' : searchParams.get('region');
  const year =
    searchParams.get('year') === 'all' ? '' : searchParams.get('year');
  const platform =
    searchParams.get('platform') === 'all' ? '' : searchParams.get('platform');
  const sort = searchParams.get('sort') === 'T' ? '' : searchParams.get('sort');
  const label =
    searchParams.get('label') === 'all' ? '' : searchParams.get('label');
  if (kind !== 'tv' && kind !== 'movie') {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }
  try {
    const result: DoubanResult = await getDoubanRecommends({
      kind,
      pageLimit,
      pageStart,
      category,
      format,
      label,
      region,
      year,
      platform,
      sort,
    });
    const cacheTime = DOUBAN_CACHE_EXPIRE.recommends;
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
