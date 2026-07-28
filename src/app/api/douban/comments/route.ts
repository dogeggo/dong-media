import { NextResponse } from 'next/server';
import '@/lib/server-cache';

import { DOUBAN_CACHE_EXPIRE } from '@/lib/cache';
import { getDoubanComments } from '@/lib/douban-api';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const start = parseInt(searchParams.get('start') || '0');
  const limit = parseInt(searchParams.get('limit') || '10');
  const sort = searchParams.get('sort') || 'new_score'; // new_score 或 time

  if (!id) {
    return NextResponse.json({ error: '缺少必要参数: id' }, { status: 400 });
  }
  // 验证参数
  if (limit < 1 || limit > 50) {
    return NextResponse.json(
      { error: 'limit 必须在 1-50 之间' },
      { status: 400 },
    );
  }
  if (start < 0) {
    return NextResponse.json({ error: 'start 不能小于 0' }, { status: 400 });
  }

  if (sort !== 'new_score' && sort !== 'time') {
    return NextResponse.json(
      { error: 'sort 参数必须是 new_score 或 time' },
      { status: 400 },
    );
  }

  try {
    const result = await getDoubanComments({
      id,
      start,
      limit,
      sort,
    });
    const cacheTime = DOUBAN_CACHE_EXPIRE.comments;
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
      { error: '获取豆瓣短评失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
