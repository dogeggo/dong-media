/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { getDoubanRecommends } from '@/lib/douban-api';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (
    !hasOnlyUniqueSearchParams(searchParams, [
      'kind',
      'limit',
      'start',
      'category',
      'format',
      'region',
      'year',
      'platform',
      'sort',
      'label',
    ])
  ) {
    return NextResponse.json(
      { error: '包含未知或重复参数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  // 获取参数
  const kind = searchParams.get('kind');
  const pageLimit = Number(searchParams.get('limit') || '20');
  const pageStart = Number(searchParams.get('start') || '0');
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
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  if (
    [category, format, region, year, platform, sort, label].some(
      (value) => value && value.length > 100,
    )
  ) {
    return NextResponse.json(
      { error: '筛选参数不能超过 100 个字符' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  if (
    !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 ||
    pageLimit > 100 ||
    !Number.isSafeInteger(pageStart) ||
    pageStart < 0 ||
    pageStart > 10_000
  ) {
    return NextResponse.json(
      { error: '分页参数格式错误' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  try {
    const params = {
      kind: kind as 'tv' | 'movie',
      pageLimit,
      pageStart,
      category,
      format,
      label,
      region,
      year,
      platform,
      sort,
    };
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.DOUBAN_RECOMMENDS,
      params,
      () => getDoubanRecommends(params),
      { isNegative: (value) => value.list.length === 0 },
    );
    return NextResponse.json(cached.value satisfies DoubanResult, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.DOUBAN_RECOMMENDS, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
