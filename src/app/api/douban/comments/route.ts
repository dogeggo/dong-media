import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { getDoubanComments } from '@/lib/douban-api';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (
    !hasOnlyUniqueSearchParams(searchParams, ['id', 'start', 'limit', 'sort'])
  ) {
    return NextResponse.json(
      { error: '包含未知或重复参数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  const id = searchParams.get('id');
  const start = Number(searchParams.get('start') || '0');
  const limit = Number(searchParams.get('limit') || '10');
  const sort = searchParams.get('sort') || 'new_score'; // new_score 或 time

  if (!id || !/^\d{1,20}$/.test(id)) {
    return NextResponse.json(
      { error: 'id 必须为有效的豆瓣数字 ID' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  // 验证参数
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json(
      { error: 'limit 必须在 1-50 之间' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  if (!Number.isSafeInteger(start) || start < 0 || start > 10_000) {
    return NextResponse.json(
      { error: 'start 必须为 0-10000 的整数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (sort !== 'new_score' && sort !== 'time') {
    return NextResponse.json(
      { error: 'sort 参数必须是 new_score 或 time' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  try {
    const params = {
      id,
      start,
      limit,
      sort: sort as 'new_score' | 'time',
    };
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.DOUBAN_COMMENTS,
      params,
      () => getDoubanComments(params),
      { isNegative: (value) => !value.data?.comments.length },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.DOUBAN_COMMENTS, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣短评失败', details: (error as Error).message },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
