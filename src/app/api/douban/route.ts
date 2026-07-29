import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { getDoubanList } from '@/lib/douban-api';
import { fetchDouBanHtml } from '@/lib/douban-challenge';
import { DoubanMovieDetail, DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (
    !hasOnlyUniqueSearchParams(searchParams, [
      'type',
      'tag',
      'pageSize',
      'pageStart',
    ])
  ) {
    return NextResponse.json(
      { error: '包含未知或重复参数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  // 获取参数
  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const pageSize = Number(searchParams.get('pageSize') || '16');
  const pageStart = Number(searchParams.get('pageStart') || '0');

  // 验证参数
  if (!type || !tag || tag.length > 100) {
    return NextResponse.json(
      { error: '缺少必要参数或 tag 超过 100 个字符' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (!['tv', 'movie'].includes(type)) {
    return NextResponse.json(
      { error: 'type 参数必须是 tv 或 movie' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }

  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
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

  if (tag === 'top250') {
    return handleTop250(pageStart);
  }

  try {
    const params = {
      tag,
      type,
      pageLimit: pageSize,
      pageStart,
    };
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.DOUBAN_LIST,
      params,
      () => getDoubanList(params),
      { isNegative: (value) => value.list.length === 0 },
    );

    return NextResponse.json(cached.value satisfies DoubanResult, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.DOUBAN_LIST, {
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

async function handleTop250(pageStart: number) {
  const url = `https://movie.douban.com/top250?start=${pageStart}&filter=`;
  try {
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.DOUBAN_TOP250,
      { pageStart },
      async () => {
        const html = await fetchDouBanHtml(url, { timeoutMs: 10000 });
        // 通过正则同时捕获影片 id、标题、封面以及评分
        const moviePattern =
          /<div class="item">[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/g;
        const movies: DoubanMovieDetail[] = [];
        let match;

        while ((match = moviePattern.exec(html)) !== null) {
          const id = match[1];
          const title = match[2];
          const cover = match[3];
          const rate = match[4] || '';

          // 处理图片 URL，确保使用 HTTPS
          const processedCover = cover.replace(/^http:/, 'https:');

          movies.push({
            id: id,
            title: title,
            poster: processedCover,
            rate: rate,
            year: '',
          });
        }

        return {
          code: 200,
          message: '获取成功',
          list: movies,
        } satisfies DoubanResult;
      },
      { isNegative: (value) => value.list.length === 0 },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.DOUBAN_TOP250, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取豆瓣 Top250 数据失败',
        details: (error as Error).message,
      },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
