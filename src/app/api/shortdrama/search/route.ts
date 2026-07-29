import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  normalizeQuery,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { searchShortDramas } from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    if (!hasOnlyUniqueSearchParams(searchParams, ['query', 'page'])) {
      return NextResponse.json(
        { error: '包含未知或重复参数' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const query = searchParams.get('query');
    const page = searchParams.get('page');

    const normalizedQuery = query ? normalizeQuery(query) : '';
    if (!normalizedQuery || normalizedQuery.length > 100) {
      return NextResponse.json(
        { error: 'query 必须为 1-100 个字符' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }

    const pageNum = page ? Number(page) : 1;

    if (!Number.isSafeInteger(pageNum) || pageNum < 1 || pageNum > 1_000) {
      return NextResponse.json(
        { error: '参数格式错误' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.SHORTDRAMA_SEARCH,
      { query: normalizedQuery, page: pageNum },
      () => searchShortDramas(normalizedQuery, pageNum),
      { isNegative: (value) => value.list.length === 0 },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.SHORTDRAMA_SEARCH, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    console.error('搜索短剧失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
