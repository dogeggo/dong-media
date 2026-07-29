import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { getDoubanCategories } from '@/lib/douban-api';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (
    !hasOnlyUniqueSearchParams(searchParams, [
      'kind',
      'category',
      'type',
      'limit',
      'start',
    ])
  ) {
    return NextResponse.json(
      { error: '包含未知或重复参数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  const target = request.url;

  // 获取参数
  const kind = searchParams.get('kind');
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = Number(searchParams.get('limit') || '20');
  const pageStart = Number(searchParams.get('start') || '0');

  // 验证参数
  if (
    !kind ||
    !category ||
    !type ||
    category.length > 100 ||
    type.length > 100
  ) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (kind !== 'tv' && kind !== 'movie') {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (!Number.isSafeInteger(pageStart) || pageStart < 0 || pageStart > 10_000) {
    return NextResponse.json(
      { error: 'pageStart 必须为 0-10000 的整数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  try {
    const params = {
      kind: kind as 'tv' | 'movie',
      category,
      type,
      pageLimit,
      pageStart,
    };
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.DOUBAN_CATEGORIES,
      params,
      () => getDoubanCategories(params),
      { isNegative: (value) => value.list.length === 0 },
    );

    return NextResponse.json(cached.value satisfies DoubanResult, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.DOUBAN_CATEGORIES, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
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
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
