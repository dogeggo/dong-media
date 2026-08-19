import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import {
  getShortDramaList,
  ShortDramaCategoryNotFoundError,
} from '@/lib/shortdrama-api';

// 强制动态路由，禁用所有缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    if (
      !hasOnlyUniqueSearchParams(searchParams, [
        'categoryId',
        'categoryName',
        'page',
      ])
    ) {
      return NextResponse.json(
        { error: '包含未知或重复参数' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const categoryId = searchParams.get('categoryId');
    const categoryName = searchParams.get('categoryName')?.trim();
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
      category < 1 ||
      category > 1_000_000 ||
      (categoryName !== undefined &&
        (categoryName.length < 1 || categoryName.length > 50)) ||
      !Number.isSafeInteger(pageNum) ||
      pageNum < 1 ||
      pageNum > 1_000
    ) {
      return NextResponse.json(
        { error: '分类或分页参数格式错误' },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.SHORTDRAMA_LIST,
      { category, categoryName: categoryName || '', page: pageNum },
      () => getShortDramaList(category, pageNum, categoryName),
      { isNegative: (value) => value.list.length === 0 },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.SHORTDRAMA_LIST, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    if (error instanceof ShortDramaCategoryNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: noStoreResponseHeaders() },
      );
    }
    console.error('获取短剧列表失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
