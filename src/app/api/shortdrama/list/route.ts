import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { getShortDramaList } from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    if (!hasOnlyUniqueSearchParams(searchParams, ['categoryId', 'page'])) {
      return NextResponse.json(
        { error: '包含未知或重复参数' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const categoryId = searchParams.get('categoryId');
    const page = searchParams.get('page');

    if (!categoryId) {
      return NextResponse.json(
        { error: '缺少必要参数: categoryId' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }

    const category = Number(categoryId);
    const pageNum = page ? Number(page) : 1;

    if (
      !Number.isSafeInteger(category) ||
      category !== 1 ||
      !Number.isSafeInteger(pageNum) ||
      pageNum < 1 ||
      pageNum > 1_000
    ) {
      return NextResponse.json(
        { error: 'categoryId 必须为 1，分页参数必须为正整数' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.SHORTDRAMA_LIST,
      { category, page: pageNum },
      () => getShortDramaList(category, pageNum),
      { isNegative: (value) => value.list.length === 0 },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.SHORTDRAMA_LIST, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    console.error('获取短剧列表失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
