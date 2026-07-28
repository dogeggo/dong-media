import { NextResponse } from 'next/server';

import { DOUBAN_CACHE_EXPIRE } from '@/lib/cache';
import { db } from '@/lib/db';
import {
  DoubanError,
  fetchTrailerWithRetry,
  getDoubanDetails,
} from '@/lib/douban-api';
import { getCache, setCache } from '@/lib/server-cache';

export const runtime = 'nodejs';
const failureCacheSeconds = DOUBAN_CACHE_EXPIRE.details_failure;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      {
        code: 400,
        message: '缺少必要参数: id',
        error: 'MISSING_PARAMETER',
      },
      { status: 400 },
    );
  }

  const failureCacheKey = `douban-details-fail-id=${id}`;
  const failureCacheHeaders = {
    'Cache-Control': `public, max-age=${failureCacheSeconds}, s-maxage=${failureCacheSeconds}, stale-while-revalidate=${failureCacheSeconds}`,
    'CDN-Cache-Control': `public, s-maxage=${failureCacheSeconds}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${failureCacheSeconds}`,
    'Netlify-Vary': 'query',
    'X-Data-Source': 'error-cache',
  };

  const saveFailureCache = async (
    status: number,
    body: {
      code: number;
      message: string;
      error: string;
      details: string;
    },
  ) => {
    try {
      await setCache(
        failureCacheKey,
        {
          status,
          body,
        },
        failureCacheSeconds,
      );
    } catch (cacheError) {
      console.warn('[Douban] 失败缓存写入失败:', cacheError);
    }
  };

  try {
    const cachedFailure = await getCache(failureCacheKey);
    if (cachedFailure?.status && cachedFailure?.body) {
      return NextResponse.json(cachedFailure.body, {
        status: cachedFailure.status,
        headers: failureCacheHeaders,
      });
    }
  } catch (cacheError) {
    console.warn('[Douban] 失败缓存读取失败:', cacheError);
  }

  try {
    // 并行获取详情和移动端API数据
    const [details, mobileData] = await Promise.all([
      getDoubanDetails(id),
      fetchTrailerWithRetry(id, 0, false),
    ]);

    // 合并数据：混合使用爬虫和移动端API的优势
    if (details.code === 200 && details.list && mobileData) {
      // 预告片来自移动端API
      details.list[0].trailerUrl = mobileData.trailerUrl;
      // Backdrop优先使用爬虫的剧照（横版高清），否则用移动端API的海报
      if (!details.list[0].backdrop && mobileData.backdrop) {
        details.list[0].backdrop = mobileData.backdrop;
      }
    }

    try {
      await db.deleteCache(failureCacheKey);
    } catch (cacheError) {
      console.warn('[Douban] 失败缓存清理失败:', cacheError);
    }

    const trailerSafeCacheTime = DOUBAN_CACHE_EXPIRE.details;
    const cacheHeaders = {
      'Cache-Control': `public, max-age=${trailerSafeCacheTime}, s-maxage=${trailerSafeCacheTime}, stale-while-revalidate=${trailerSafeCacheTime}`,
      'CDN-Cache-Control': `public, s-maxage=${trailerSafeCacheTime}`,
      'Vercel-CDN-Cache-Control': `public, s-maxage=${trailerSafeCacheTime}`,
      'Netlify-Vary': 'query',
      'X-Data-Source': 'scraper-cached',
    };
    return NextResponse.json(details, { headers: cacheHeaders });
  } catch (error) {
    // 处理 DoubanError
    if (error instanceof DoubanError) {
      const statusCode =
        error.status ||
        (error.code === 'TIMEOUT'
          ? 504
          : error.code === 'RATE_LIMIT'
            ? 429
            : error.code === 'SERVER_ERROR'
              ? 502
              : 500);

      const responseBody = {
        code: statusCode,
        message: error.message,
        error: error.code,
        details: `获取豆瓣详情失败 (ID: ${id})`,
      };
      await saveFailureCache(statusCode, responseBody);
      return NextResponse.json(responseBody, {
        status: statusCode,
        headers: failureCacheHeaders,
      });
    }

    // 解析错误
    if (error instanceof Error && error.message.includes('解析')) {
      const responseBody = {
        code: 500,
        message: '解析豆瓣数据失败，可能是页面结构已变化',
        error: 'PARSE_ERROR',
        details: error.message,
      };
      await saveFailureCache(500, responseBody);
      return NextResponse.json(responseBody, {
        status: 500,
        headers: failureCacheHeaders,
      });
    }

    // 未知错误
    const responseBody = {
      code: 500,
      message: '获取豆瓣详情失败',
      error: 'UNKNOWN_ERROR',
      details: error instanceof Error ? error.message : '未知错误',
    };
    await saveFailureCache(500, responseBody);
    return NextResponse.json(responseBody, {
      status: 500,
      headers: failureCacheHeaders,
    });
  }
}
