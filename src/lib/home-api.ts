import type {
  HomeBangumiItem,
  HomeUpcomingItem,
} from './home-recommendations.ts';
import type {
  DoubanMovieDetail,
  DoubanResult,
  ShortDramaItem,
} from './types.ts';

export class HomeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'HTTP' | 'INVALID_DATA' | 'TIMEOUT' | 'WARMING',
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HomeApiError';
  }
}

async function requestJson<T>(
  url: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<{ data: T; response: Response }> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
  let response: Response;
  try {
    response = await fetch(url, { signal: combinedSignal });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new HomeApiError('请求超时', 504, 'TIMEOUT');
    }
    throw error;
  }

  if (response.status === 202) {
    const retryAfter = Number(response.headers.get('Retry-After') || '3');
    throw new HomeApiError(
      '数据正在后台准备',
      202,
      'WARMING',
      Math.max(1, retryAfter) * 1_000,
    );
  }
  if (!response.ok) {
    throw new HomeApiError(
      `请求失败（HTTP ${response.status}）`,
      response.status,
      'HTTP',
    );
  }
  return { data: (await response.json()) as T, response };
}

export async function fetchHomeDoubanCategory(
  params: { kind: 'movie' | 'tv'; category: string; type: string },
  signal: AbortSignal,
): Promise<DoubanMovieDetail[]> {
  const search = new URLSearchParams({
    kind: params.kind,
    category: params.category,
    type: params.type,
    limit: '20',
    start: '0',
  });
  const { data } = await requestJson<DoubanResult>(
    `/api/douban/categories?${search}`,
    signal,
  );
  if (data.code !== 200 || !Array.isArray(data.list)) {
    throw new HomeApiError('豆瓣分类响应格式错误', 502, 'INVALID_DATA');
  }
  return data.list;
}

export async function fetchHomeShortDramas(signal: AbortSignal) {
  const { data } = await requestJson<ShortDramaItem[]>(
    '/api/shortdrama/recommend?size=15',
    signal,
  );
  if (!Array.isArray(data)) {
    throw new HomeApiError('短剧响应格式错误', 502, 'INVALID_DATA');
  }
  return data;
}

export async function fetchHomeBangumi(signal: AbortSignal) {
  const { data } = await requestJson<{
    items: HomeBangumiItem[];
    weekday: string;
  }>('/api/home/bangumi', signal, 8_000);
  if (!Array.isArray(data.items)) {
    throw new HomeApiError('新番响应格式错误', 502, 'INVALID_DATA');
  }
  return data.items;
}

export async function fetchHomeUpcoming(signal: AbortSignal) {
  const { data } = await requestJson<{
    items: HomeUpcomingItem[];
    refreshing?: boolean;
  }>('/api/home/upcoming', signal, 8_000);
  if (!Array.isArray(data.items)) {
    throw new HomeApiError('上映日历响应格式错误', 502, 'INVALID_DATA');
  }
  return data.items;
}
