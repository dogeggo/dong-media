import 'server-only';

import { CACHE_POLICIES, cacheService } from '@/lib/cache-system';
import { getDoubanCategories, getDoubanDetails } from '@/lib/douban-api';
import type { DoubanMovieDetail, DoubanResult } from '@/lib/types';
import type { InitialHomeRecommendations } from '@/hooks/useHomeRecommendations';

const CATEGORY_TIMEOUT_MS = 2_500;
const HERO_DETAIL_TIMEOUT_MS = 1_000;

const HOME_CATEGORIES = {
  hotAnime: {
    kind: 'tv',
    category: 'tv',
    type: 'tv_animation',
  },
  hotMovies: {
    kind: 'movie',
    category: '热门',
    type: '全部',
  },
  hotTvShows: {
    kind: 'tv',
    category: 'tv',
    type: 'tv',
  },
  hotVarietyShows: {
    kind: 'tv',
    category: 'show',
    type: 'show',
  },
} as const;

async function withinTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadCategory(
  params: (typeof HOME_CATEGORIES)[keyof typeof HOME_CATEGORIES],
): Promise<DoubanMovieDetail[]> {
  const cacheParams = {
    ...params,
    pageLimit: 20,
    pageStart: 0,
  };
  const cached = await cacheService.getOrLoadResult(
    CACHE_POLICIES.DOUBAN_CATEGORIES,
    cacheParams,
    () => getDoubanCategories(cacheParams),
    { isNegative: (value: DoubanResult) => value.list.length === 0 },
  );
  return cached.value.list;
}

async function loadHeroDetail(
  item: DoubanMovieDetail | undefined,
): Promise<DoubanMovieDetail | undefined> {
  if (!item?.id) return undefined;
  const result = await withinTimeout(
    cacheService.getOrLoad(
      CACHE_POLICIES.DOUBAN_DETAILS,
      { id: item.id },
      () => getDoubanDetails(item.id),
      { isNegative: (value: DoubanResult) => !value.list?.length },
    ),
    HERO_DETAIL_TIMEOUT_MS,
  );
  return result?.list?.[0];
}

/**
 * 聚合公共首页数据。每个上游独立超时和降级，任何单一数据源都不会让首页
 * RSC 流永久等待；客户端查询会接管未在预算内返回的数据源。
 */
export async function getInitialHomeRecommendations(): Promise<InitialHomeRecommendations> {
  const categoryEntries = Object.entries(HOME_CATEGORIES) as Array<
    [
      keyof typeof HOME_CATEGORIES,
      (typeof HOME_CATEGORIES)[keyof typeof HOME_CATEGORIES],
    ]
  >;
  const categoryTasks = Object.fromEntries(
    categoryEntries.map(([key, params]) => [
      key,
      withinTimeout(loadCategory(params), CATEGORY_TIMEOUT_MS),
    ]),
  ) as Record<
    keyof typeof HOME_CATEGORIES,
    Promise<DoubanMovieDetail[] | undefined>
  >;

  const heroDetailTask = categoryTasks.hotMovies.then((movies) =>
    loadHeroDetail(movies?.[0]),
  );
  const [hotAnime, hotMovies, hotTvShows, hotVarietyShows, heroDetail] =
    await Promise.all([
      categoryTasks.hotAnime,
      categoryTasks.hotMovies,
      categoryTasks.hotTvShows,
      categoryTasks.hotVarietyShows,
      heroDetailTask,
    ]);

  return {
    hotAnime,
    hotMovies:
      hotMovies && heroDetail
        ? hotMovies.map((item, index) =>
            index === 0 ? { ...item, ...heroDetail } : item,
          )
        : hotMovies,
    hotTvShows,
    hotVarietyShows,
  };
}
