'use client';

import { useQuery } from '@tanstack/react-query';

import {
  fetchHomeBangumi,
  fetchHomeDoubanCategory,
  fetchHomeShortDramas,
  fetchHomeUpcoming,
  HomeApiError,
} from '@/lib/home-api';
import type {
  HomeBangumiItem,
  HomeUpcomingItem,
} from '@/lib/home-recommendations';
import type { DoubanMovieDetail, ShortDramaItem } from '@/lib/types';

export type HomeSectionKey =
  | 'anime'
  | 'bangumi'
  | 'movies'
  | 'shortDramas'
  | 'tv'
  | 'upcoming'
  | 'variety';

export interface InitialHomeRecommendations {
  hotAnime?: DoubanMovieDetail[];
  hotMovies?: DoubanMovieDetail[];
  hotShortDramas?: ShortDramaItem[];
  hotTvShows?: DoubanMovieDetail[];
  hotVarietyShows?: DoubanMovieDetail[];
  todayAnimes?: HomeBangumiItem[];
  upcomingReleases?: HomeUpcomingItem[];
}

const HOME_STALE_TIME = 5 * 60 * 1_000;
const HOME_GC_TIME = 2 * 60 * 60 * 1_000;

export const homeQueryKeys = {
  root: ['home', 'recommendations'] as const,
  category: (name: 'anime' | 'movies' | 'tv' | 'variety') =>
    [...homeQueryKeys.root, 'category', name] as const,
  shortDramas: () => [...homeQueryKeys.root, 'short-dramas'] as const,
  bangumi: () => [...homeQueryKeys.root, 'bangumi-today'] as const,
  upcoming: () => [...homeQueryKeys.root, 'upcoming'] as const,
};

function shouldRetry(failureCount: number, error: Error) {
  if (error instanceof HomeApiError && error.code === 'WARMING') {
    return failureCount < 6;
  }
  if (
    error instanceof HomeApiError &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return false;
  }
  return failureCount < 1;
}

function retryDelay(attempt: number, error: Error) {
  if (error instanceof HomeApiError && error.retryAfterMs) {
    return error.retryAfterMs;
  }
  return Math.min(1_000 * 2 ** attempt, 4_000);
}

const commonQueryOptions = {
  staleTime: HOME_STALE_TIME,
  gcTime: HOME_GC_TIME,
  retry: shouldRetry,
  retryDelay,
};

function errorWithoutData(error: Error | null, itemCount: number) {
  if (!error || itemCount > 0) return null;
  return error.message || '加载失败';
}

export function useHomeRecommendations(
  initialData: InitialHomeRecommendations = {},
) {
  const moviesQuery = useQuery({
    queryKey: homeQueryKeys.category('movies'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'movie', category: '热门', type: '全部' },
        signal,
      ),
    ...commonQueryOptions,
    initialData: initialData.hotMovies,
  });
  const tvQuery = useQuery({
    queryKey: homeQueryKeys.category('tv'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'tv', category: 'tv', type: 'tv' },
        signal,
      ),
    ...commonQueryOptions,
    initialData: initialData.hotTvShows,
  });
  const varietyQuery = useQuery({
    queryKey: homeQueryKeys.category('variety'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'tv', category: 'show', type: 'show' },
        signal,
      ),
    ...commonQueryOptions,
    initialData: initialData.hotVarietyShows,
  });
  const animeQuery = useQuery({
    queryKey: homeQueryKeys.category('anime'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'tv', category: 'tv', type: 'tv_animation' },
        signal,
      ),
    ...commonQueryOptions,
    initialData: initialData.hotAnime,
  });
  const shortDramasQuery = useQuery({
    queryKey: homeQueryKeys.shortDramas(),
    queryFn: ({ signal }) => fetchHomeShortDramas(signal),
    ...commonQueryOptions,
    initialData: initialData.hotShortDramas,
  });
  const bangumiQuery = useQuery({
    queryKey: homeQueryKeys.bangumi(),
    queryFn: ({ signal }) => fetchHomeBangumi(signal),
    ...commonQueryOptions,
    initialData: initialData.todayAnimes,
  });
  const upcomingQuery = useQuery({
    queryKey: homeQueryKeys.upcoming(),
    queryFn: ({ signal }) => fetchHomeUpcoming(signal),
    ...commonQueryOptions,
    initialData: initialData.upcomingReleases,
  });

  const hotMovies = moviesQuery.data || [];
  const hotTvShows = tvQuery.data || [];
  const hotVarietyShows = varietyQuery.data || [];
  const hotAnime = animeQuery.data || [];

  const hotShortDramas = shortDramasQuery.data || [];
  const todayAnimes = bangumiQuery.data || [];
  const upcomingReleases = upcomingQuery.data || [];
  const loading = {
    movies: moviesQuery.isPending && hotMovies.length === 0,
    tv: tvQuery.isPending && hotTvShows.length === 0,
    variety: varietyQuery.isPending && hotVarietyShows.length === 0,
    anime: animeQuery.isPending && hotAnime.length === 0,
    shortDramas: shortDramasQuery.isPending && hotShortDramas.length === 0,
    bangumi: bangumiQuery.isPending && todayAnimes.length === 0,
    upcoming: upcomingQuery.isPending && upcomingReleases.length === 0,
  };
  const errors: Record<HomeSectionKey, string | null> = {
    movies: errorWithoutData(moviesQuery.error, hotMovies.length),
    tv: errorWithoutData(tvQuery.error, hotTvShows.length),
    variety: errorWithoutData(varietyQuery.error, hotVarietyShows.length),
    anime: errorWithoutData(animeQuery.error, hotAnime.length),
    shortDramas: errorWithoutData(
      shortDramasQuery.error,
      hotShortDramas.length,
    ),
    bangumi: errorWithoutData(bangumiQuery.error, todayAnimes.length),
    upcoming: errorWithoutData(upcomingQuery.error, upcomingReleases.length),
  };
  const retry: Record<HomeSectionKey, () => void> = {
    movies: () => void moviesQuery.refetch(),
    tv: () => void tvQuery.refetch(),
    variety: () => void varietyQuery.refetch(),
    anime: () => void animeQuery.refetch(),
    shortDramas: () => void shortDramasQuery.refetch(),
    bangumi: () => void bangumiQuery.refetch(),
    upcoming: () => void upcomingQuery.refetch(),
  };

  return {
    errors,
    hotAnime,
    hotMovies,
    hotShortDramas,
    hotTvShows,
    hotVarietyShows,
    loading,
    retry,
    todayAnimes,
    upcomingReleases,
  };
}
