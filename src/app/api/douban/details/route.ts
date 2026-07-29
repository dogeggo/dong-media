import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import {
  DoubanError,
  fetchTrailerWithRetry,
  getDoubanDetails,
} from '@/lib/douban-api';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^\d{1,20}$/.test(id)) {
    return NextResponse.json(
      {
        code: 400,
        message: 'id 必须为有效的豆瓣数字 ID',
        error: 'INVALID_PARAMETER',
      },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  try {
    const [details, mobileData] = await Promise.all([
      cacheService.getOrLoad(
        CACHE_POLICIES.DOUBAN_DETAILS,
        { id },
        () => getDoubanDetails(id),
        { isNegative: (value) => !value.list?.length },
      ),
      cacheService.getOrLoad(
        CACHE_POLICIES.DOUBAN_TRAILER,
        { id },
        () => fetchTrailerWithRetry(id, 0, false),
        { isNegative: (value) => !value.trailerUrl },
      ),
    ]);

    const result = {
      ...details,
      list: details.list.map((item, index) =>
        index === 0
          ? {
              ...item,
              trailerUrl: mobileData.trailerUrl,
              backdrop: item.backdrop || mobileData.backdrop,
            }
          : item,
      ),
    };

    // This projection includes a short-lived trailer URL. Only the split
    // server entries above are cached; the combined response is never shared.
    return NextResponse.json(result, { headers: noStoreResponseHeaders() });
  } catch (error) {
    if (error instanceof DoubanError) {
      const status =
        error.status ||
        (error.code === 'TIMEOUT'
          ? 504
          : error.code === 'RATE_LIMIT'
            ? 429
            : error.code === 'SERVER_ERROR'
              ? 502
              : 500);
      return NextResponse.json(
        {
          code: status,
          message: error.message,
          error: error.code,
          details: `获取豆瓣详情失败 (ID: ${id})`,
        },
        { status, headers: noStoreResponseHeaders() },
      );
    }

    const parseError = error instanceof Error && error.message.includes('解析');
    return NextResponse.json(
      {
        code: 500,
        message: parseError
          ? '解析豆瓣数据失败，可能是页面结构已变化'
          : '获取豆瓣详情失败',
        error: parseError ? 'PARSE_ERROR' : 'UNKNOWN_ERROR',
        details: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
