import { NextResponse } from 'next/server';

import { DOUBAN_CACHE_EXPIRE, getDouBanCacheKey } from '@/lib/cache';
import { getDoubanList } from '@/lib/douban-api';
import { fetchDouBanHtml } from '@/lib/douban-challenge';
import { getCache, setCache } from '@/lib/server-cache';
import { DoubanMovieDetail, DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const pageSize = parseInt(searchParams.get('pageSize') || '16');
  const pageStart = parseInt(searchParams.get('pageStart') || '0');

  // 验证参数
  if (!type || !tag) {
    return NextResponse.json(
      { error: '缺少必要参数: type 或 tag' },
      { status: 400 },
    );
  }

  if (!['tv', 'movie'].includes(type)) {
    return NextResponse.json(
      { error: 'type 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }

  if (pageSize < 1 || pageSize > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 },
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 },
    );
  }

  if (tag === 'top250') {
    return handleTop250(pageStart);
  }

  try {
    const response: DoubanResult = await getDoubanList({
      tag,
      type,
      pageLimit: pageSize,
      pageStart,
    });

    const cacheTime = DOUBAN_CACHE_EXPIRE.lists;
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}

async function handleTop250(pageStart: number) {
  const url = `https://movie.douban.com/top250?start=${pageStart}&filter=`;
  const cacheKey = getDouBanCacheKey('top250', {});
  const cacheTime = DOUBAN_CACHE_EXPIRE.top250;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  }

  return fetchDouBanHtml(url, {
    timeoutMs: 10000,
  })
    .then(async (html) => {
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

      const apiResponse: DoubanResult = {
        code: 200,
        message: '获取成功',
        list: movies,
      };
      await setCache(cacheKey, apiResponse, cacheTime);
      return NextResponse.json(apiResponse, {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      });
    })
    .catch((error) => {
      return NextResponse.json(
        {
          error: '获取豆瓣 Top250 数据失败',
          details: (error as Error).message,
        },
        { status: 500 },
      );
    });
}
