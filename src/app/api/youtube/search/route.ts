import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  CACHE_POLICIES,
  cacheService,
  normalizeQuery,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { hasSpecialFeaturePermission, loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

const CONTENT_TYPE_KEYWORDS: Record<string, string> = {
  music: 'music',
  movie: 'trailer',
  educational: 'tutorial',
  gaming: 'gameplay',
  sports: 'sports',
  news: 'news',
};
const YOUTUBE_CONTENT_TYPES = new Set([
  'all',
  ...Object.keys(CONTENT_TYPE_KEYWORDS),
]);
const YOUTUBE_ORDERS = new Set([
  'date',
  'rating',
  'relevance',
  'title',
  'videoCount',
  'viewCount',
]);

const DEMO_RESULTS = [
  ['dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up', 'Rick Astley'],
  ['9bZkp7q19f0', 'PSY - GANGNAM STYLE', 'officialpsy'],
  ['kJQP7kiw5Fk', 'Luis Fonsi - Despacito', 'LuisFonsiVEVO'],
  ['fJ9rUzIMcZQ', 'Queen – Bohemian Rhapsody', 'Queen Official'],
].map(([videoId, title, channelTitle]) => ({
  id: { videoId },
  snippet: {
    title,
    description: title,
    thumbnails: {
      medium: {
        url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        width: 320,
        height: 180,
      },
    },
    channelTitle,
    publishedAt: '2009-01-01T00:00:00Z',
  },
}));

class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus: number,
  ) {
    super(message);
  }
}

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawQuery = request.nextUrl.searchParams.get('q') || '';
  const query = normalizeQuery(rawQuery);
  const contentType = request.nextUrl.searchParams.get('contentType') || 'all';
  const order = request.nextUrl.searchParams.get('order') || 'relevance';
  if (!query || query.length > 100) {
    return privateJson({ error: '搜索关键词不能为空' }, { status: 400 });
  }
  if (!YOUTUBE_CONTENT_TYPES.has(contentType) || !YOUTUBE_ORDERS.has(order)) {
    return privateJson({ error: '搜索类型或排序参数无效' }, { status: 400 });
  }

  const config = await loadConfig();
  const permitted = await hasSpecialFeaturePermission(
    authInfo.username,
    'youtube-search',
    config,
  );
  if (!permitted) {
    return privateJson(
      {
        success: false,
        error: '您无权使用YouTube搜索功能，请联系管理员开通权限',
      },
      { status: 403 },
    );
  }

  const youtubeConfig = config.YouTubeConfig;
  if (!youtubeConfig?.enabled) {
    return privateJson(
      { success: false, error: 'YouTube搜索功能未启用' },
      { status: 400 },
    );
  }

  const requestedMax = Number(
    request.nextUrl.searchParams.get('maxResults') ||
      String(youtubeConfig.maxResults || 25),
  );
  if (
    !Number.isSafeInteger(requestedMax) ||
    requestedMax < 1 ||
    requestedMax > 50
  ) {
    return privateJson(
      { error: 'maxResults 必须为 1-50 的整数' },
      { status: 400 },
    );
  }
  const maxResults = requestedMax;
  const cacheParams = {
    query,
    contentType,
    order,
    maxResults,
    demo: youtubeConfig.enableDemo || !youtubeConfig.apiKey,
  };

  try {
    const result = await cacheService.getOrLoad(
      CACHE_POLICIES.YOUTUBE_SEARCH,
      cacheParams,
      async () => {
        if (youtubeConfig.enableDemo || !youtubeConfig.apiKey) {
          const videos = DEMO_RESULTS.slice(0, maxResults).map((video) => ({
            ...video,
            snippet: {
              ...video.snippet,
              title: `${query} - ${video.snippet.title}`,
            },
          }));
          return {
            success: true,
            videos,
            total: videos.length,
            query,
            source: 'demo',
            warning: youtubeConfig.enableDemo
              ? '当前为演示模式，显示模拟数据'
              : 'API Key未配置，显示模拟数据',
          };
        }

        const suffix = CONTENT_TYPE_KEYWORDS[contentType];
        const enhancedQuery = suffix ? `${query} ${suffix}` : query;
        const url = new URL(`${YOUTUBE_API_BASE}/search`);
        url.searchParams.set('key', youtubeConfig.apiKey);
        url.searchParams.set('q', enhancedQuery);
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('type', 'video');
        url.searchParams.set('maxResults', String(maxResults));
        url.searchParams.set('order', order);

        const response = await fetch(url);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new YouTubeApiError(
            youtubeErrorMessage(response.status, payload),
            response.status,
          );
        }
        const data = await response.json();
        return {
          success: true,
          videos: data.items || [],
          total: data.pageInfo?.totalResults || 0,
          query,
          source: 'youtube',
        };
      },
      { isNegative: (value) => value.videos.length === 0 },
    );
    return privateJson(result);
  } catch (error) {
    if (error instanceof YouTubeApiError) {
      return privateJson(
        { success: false, error: error.message },
        { status: error.upstreamStatus === 429 ? 429 : 400 },
      );
    }

    const videos = DEMO_RESULTS.slice(0, Math.min(maxResults, 10)).map(
      (video) => ({
        ...video,
        snippet: {
          ...video.snippet,
          title: `${query} - ${video.snippet.title}`,
        },
      }),
    );
    const fallback = {
      success: true,
      videos,
      total: videos.length,
      query,
      source: 'fallback',
    };
    await cacheService.set(
      CACHE_POLICIES.YOUTUBE_SEARCH,
      cacheParams,
      fallback,
      {
        isNegative: () => true,
      },
    );
    return privateJson(fallback);
  }
}

function youtubeErrorMessage(status: number, payload: any): string {
  const reason = payload?.error?.errors?.[0]?.reason;
  const message = payload?.error?.message || '';
  if (
    status === 429 ||
    reason === 'quotaExceeded' ||
    message.includes('quota')
  ) {
    return 'YouTube API配额已用完，请稍后重试';
  }
  if (status === 401 || reason === 'keyInvalid') {
    return 'YouTube API Key无效，请在管理后台检查配置';
  }
  if (status === 403) return 'YouTube API访问被拒绝，请检查API权限配置';
  return `YouTube API请求失败 (${status})`;
}
