'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  fetchHomeBangumi,
  fetchHomeDoubanCategory,
  fetchHomeDoubanDetail,
  fetchHomeShortDramas,
  fetchHomeUpcoming,
  HomeApiError,
} from '@/lib/home-api';
import type { DoubanMovieDetail } from '@/lib/types';

export type HomeSectionKey =
  | 'anime'
  | 'bangumi'
  | 'movies'
  | 'shortDramas'
  | 'tv'
  | 'upcoming'
  | 'variety';

const HOME_STALE_TIME = 5 * 60 * 1_000;
const HOME_GC_TIME = 2 * 60 * 60 * 1_000;

export const homeQueryKeys = {
  root: ['home', 'recommendations'] as const,
  category: (name: 'anime' | 'movies' | 'tv' | 'variety') =>
    [...homeQueryKeys.root, 'category', name] as const,
  heroDetails: (ids: string[]) =>
    [...homeQueryKeys.root, 'hero-details', ...ids] as const,
  shortDramas: () => [...homeQueryKeys.root, 'short-dramas'] as const,
  bangumi: () => [...homeQueryKeys.root, 'bangumi-today'] as const,
  upcoming: () => [...homeQueryKeys.root, 'upcoming'] as const,
};

function shouldRetry(failureCount: number, error: Error) {
  if (error instanceof HomeApiError && error.code === 'WARMING') {
    return failureCount < 6;
  }
  if (error instanceof HomeApiError && error.status === 401) return false;
  return failureCount < 2;
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
  refetchOnMount: 'always' as const,
  retry: shouldRetry,
  retryDelay,
};

function mergeDetails(
  items: DoubanMovieDetail[],
  details: Map<string, DoubanMovieDetail>,
) {
  return items.map((item) => {
    const detail = details.get(item.id);
    return detail ? { ...item, ...detail } : item;
  });
}

function errorWithoutData(error: Error | null, itemCount: number) {
  if (!error || itemCount > 0) return null;
  return error.message || '加载失败';
}

async function fetchHeroDetails(ids: string[], signal: AbortSignal) {
  const entries: Array<[string, DoubanMovieDetail]> = [];
  for (let index = 0; index < ids.length; index += 2) {
    const batch = ids.slice(index, index + 2);
    const results = await Promise.allSettled(
      batch.map((id) => fetchHomeDoubanDetail(id, signal)),
    );
    if (signal.aborted) throw signal.reason;
    results.forEach((result, resultIndex) => {
      if (result.status === 'fulfilled' && result.value) {
        entries.push([batch[resultIndex], result.value]);
      }
    });
  }
  return entries;
}

export function useHomeRecommendations() {
  const moviesQuery = useQuery({
    queryKey: homeQueryKeys.category('movies'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'movie', category: '热门', type: '全部' },
        signal,
      ),
    ...commonQueryOptions,
  });
  const tvQuery = useQuery({
    queryKey: homeQueryKeys.category('tv'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'tv', category: 'tv', type: 'tv' },
        signal,
      ),
    ...commonQueryOptions,
  });
  const varietyQuery = useQuery({
    queryKey: homeQueryKeys.category('variety'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'tv', category: 'show', type: 'show' },
        signal,
      ),
    ...commonQueryOptions,
  });
  const animeQuery = useQuery({
    queryKey: homeQueryKeys.category('anime'),
    queryFn: ({ signal }) =>
      fetchHomeDoubanCategory(
        { kind: 'tv', category: 'tv', type: 'tv_animation' },
        signal,
      ),
    ...commonQueryOptions,
  });
  const shortDramasQuery = useQuery({
    queryKey: homeQueryKeys.shortDramas(),
    queryFn: ({ signal }) => fetchHomeShortDramas(signal),
    ...commonQueryOptions,
  });
  const bangumiQuery = useQuery({
    queryKey: homeQueryKeys.bangumi(),
    queryFn: ({ signal }) => fetchHomeBangumi(signal),
    ...commonQueryOptions,
  });
  const upcomingQuery = useQuery({
    queryKey: homeQueryKeys.upcoming(),
    queryFn: ({ signal }) => fetchHomeUpcoming(signal),
    ...commonQueryOptions,
  });

  const baseMovies = moviesQuery.data || [];
  const baseTvShows = tvQuery.data || [];
  const baseVarietyShows = varietyQuery.data || [];
  const baseAnime = animeQuery.data || [];
  const detailIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...baseMovies.slice(0, 2).map((item) => item.id),
          ...baseTvShows.slice(0, 2).map((item) => item.id),
          ...baseVarietyShows.slice(0, 1).map((item) => item.id),
          ...baseAnime.slice(0, 1).map((item) => item.id),
        ]),
      ),
    [baseAnime, baseMovies, baseTvShows, baseVarietyShows],
  );
  const heroDetailsQuery = useQuery({
    queryKey: homeQueryKeys.heroDetails(detailIds),
    queryFn: ({ signal }) => fetchHeroDetails(detailIds, signal),
    enabled: detailIds.length > 0,
    ...commonQueryOptions,
    staleTime: 30 * 60 * 1_000,
  });
  const details = useMemo(
    () => new Map(heroDetailsQuery.data || []),
    [heroDetailsQuery.data],
  );

  const hotMovies = useMemo(
    () => mergeDetails(baseMovies, details),
    [baseMovies, details],
  );
  const hotTvShows = useMemo(
    () => mergeDetails(baseTvShows, details),
    [baseTvShows, details],
  );
  const hotVarietyShows = useMemo(
    () => mergeDetails(baseVarietyShows, details),
    [baseVarietyShows, details],
  );
  const hotAnime = useMemo(
    () => mergeDetails(baseAnime, details),
    [baseAnime, details],
  );

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
