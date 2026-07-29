import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { getShortDramaCategories } from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: Request) {
  try {
    if (!hasOnlyUniqueSearchParams(new URL(request.url).searchParams, [])) {
      return NextResponse.json(
        { error: '包含未知或重复参数' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.SHORTDRAMA_CATEGORIES,
      {},
      getShortDramaCategories,
      { isNegative: (value) => value.length === 0 },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.SHORTDRAMA_CATEGORIES, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    console.error('获取短剧分类失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
