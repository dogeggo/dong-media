import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { fetchTrailerWithRetry } from '@/lib/douban-api';

function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^\d{1,20}$/.test(id)) {
    return noStoreJson(
      {
        code: 400,
        message: 'id 必须为有效的豆瓣数字 ID',
        error: 'INVALID_PARAMETER',
      },
      { status: 400 },
    );
  }

  try {
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.DOUBAN_TRAILER,
      { id },
      () => fetchTrailerWithRetry(id, 0, false),
      { forceRefresh: true, isNegative: (value) => !value.trailerUrl },
    );
    if (cached.status === 'STALE') {
      return noStoreJson(
        {
          code: 502,
          message: '刷新 trailer URL 失败，已保留旧缓存',
          error: 'STALE_PRESERVED',
          stalePreserved: true,
        },
        { status: 502 },
      );
    }
    const trailer = cached.value;
    if (!trailer.trailerUrl) {
      return noStoreJson(
        {
          code: 404,
          message: '该影片没有预告片',
          error: 'NO_TRAILER',
        },
        { status: 404 },
      );
    }

    return noStoreJson({
      code: 200,
      message: '获取成功',
      data: {
        trailerUrl: trailer.trailerUrl,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      // 超时错误
      if (error.name === 'AbortError') {
        return noStoreJson(
          {
            code: 504,
            message: '请求超时，豆瓣响应过慢',
            error: 'TIMEOUT',
          },
          { status: 504 },
        );
      }

      // 没有预告片
      if (error.message.includes('没有预告片')) {
        return noStoreJson(
          {
            code: 404,
            message: error.message,
            error: 'NO_TRAILER',
          },
          { status: 404 },
        );
      }

      // 其他错误
      return noStoreJson(
        {
          code: 500,
          message: '刷新 trailer URL 失败',
          error: 'FETCH_ERROR',
          details: error.message,
        },
        { status: 500 },
      );
    }

    return noStoreJson(
      {
        code: 500,
        message: '刷新 trailer URL 失败',
        error: 'UNKNOWN_ERROR',
      },
      { status: 500 },
    );
  }
}
