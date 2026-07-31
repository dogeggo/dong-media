'use client';

import {
  Calendar,
  ChevronRight,
  Film,
  Play,
  RefreshCw,
  Sparkles,
  Tv,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { memo, useMemo } from 'react';

import type {
  HomeBangumiItem,
  HomeUpcomingItem,
} from '@/lib/home-recommendations';
import type { DoubanMovieDetail, ShortDramaItem } from '@/lib/types';
import type { HomeSectionKey } from '@/hooks/useHomeRecommendations';

import DeferredSection from '@/components/DeferredSection';
import ScrollableRow from '@/components/ScrollableRow';
import SectionTitle from '@/components/SectionTitle';
import ShortDramaCard from '@/components/ShortDramaCard';
import SkeletonCard from '@/components/SkeletonCard';

const VideoCard = dynamic(() => import('@/components/VideoCard'), {
  ssr: false,
  loading: () => <SkeletonCard />,
});

const SECTION_PLACEHOLDER = 'min-h-[22rem] sm:min-h-[28rem]';
const SKELETON_ITEMS = Array.from({ length: 8 }, (_, index) => index);

type UpcomingFilter = 'all' | 'movie' | 'tv';

interface SectionLoadingState {
  bangumi: boolean;
  movies: boolean;
  shortDramas: boolean;
  tv: boolean;
  upcoming: boolean;
  variety: boolean;
}

interface HomeRecommendationSectionsProps {
  errors: Record<HomeSectionKey, string | null>;
  hotMovies: DoubanMovieDetail[];
  hotShortDramas: ShortDramaItem[];
  hotTvShows: DoubanMovieDetail[];
  hotVarietyShows: DoubanMovieDetail[];
  loading: SectionLoadingState;
  onUpcomingFilterChange: (filter: UpcomingFilter) => void;
  retry: Record<HomeSectionKey, () => void>;
  today: Date;
  todayAnimes: HomeBangumiItem[];
  upcomingFilter: UpcomingFilter;
  upcomingReleases: HomeUpcomingItem[];
}

function LoadingCards() {
  return SKELETON_ITEMS.map((index) => <SkeletonCard key={index} />);
}

function SectionLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className='flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-6 text-center dark:border-gray-700 dark:bg-gray-900/40'
      role='alert'
    >
      <p className='text-sm text-gray-500 dark:text-gray-400'>{message}</p>
      <button
        type='button'
        onClick={onRetry}
        className='inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600'
      >
        <RefreshCw className='h-4 w-4' />
        重新加载
      </button>
    </div>
  );
}

function UpcomingLoadingSection() {
  const filterPlaceholders = [
    { key: 'all', width: 72 },
    { key: 'movie', width: 72 },
    { key: 'tv', width: 88 },
  ];

  return (
    <section
      aria-busy='true'
      className='mb-2 sm:mb-8'
      data-upcoming-placeholder='true'
    >
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='即将上映'
          icon={Calendar}
          iconColor='text-orange-500'
        />
        <Link
          href='/release-calendar'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>

      <div aria-hidden='true' className='mb-4 flex gap-2'>
        {filterPlaceholders.map(({ key, width }) => (
          <div
            key={key}
            className='h-9 animate-pulse rounded-lg bg-gray-200 motion-reduce:animate-none dark:bg-gray-800'
            style={{ width }}
          />
        ))}
      </div>

      <ScrollableRow>{LoadingCards()}</ScrollableRow>
    </section>
  );
}

const UpcomingSection = memo(function UpcomingSection({
  error,
  filter,
  onFilterChange,
  onRetry,
  releases,
  today,
}: {
  filter: UpcomingFilter;
  error: string | null;
  onFilterChange: (filter: UpcomingFilter) => void;
  onRetry: () => void;
  releases: HomeUpcomingItem[];
  today: Date;
}) {
  const counts = useMemo(
    () => ({
      all: releases.length,
      movie: releases.filter((release) => release.type === 'movie').length,
      tv: releases.filter((release) => release.type === 'tv').length,
    }),
    [releases],
  );

  const filteredReleases = useMemo(
    () =>
      releases.filter((release) => filter === 'all' || release.type === filter),
    [filter, releases],
  );

  return (
    <section className='mb-2 sm:mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='即将上映'
          icon={Calendar}
          iconColor='text-orange-500'
        />
        <Link
          href='/release-calendar'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>

      <div className='mb-4 flex gap-2'>
        {(
          [
            { key: 'all', label: '全部' },
            { key: 'movie', label: '电影' },
            { key: 'tv', label: '电视剧' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onFilterChange(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
              filter === key
                ? 'bg-orange-500 text-white shadow-md'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {label}
            {counts[key] > 0 && (
              <span
                className={`ml-1.5 text-xs ${
                  filter === key
                    ? 'text-white/80'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                ({counts[key]})
              </span>
            )}
          </button>
        ))}
      </div>

      {error && releases.length === 0 ? (
        <SectionLoadError message={error} onRetry={onRetry} />
      ) : (
        <ScrollableRow enableVirtualization>
          {filteredReleases.map((release) => {
            const releaseDate = new Date(release.releaseDate);
            const daysDiff = Math.ceil(
              (releaseDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
            );
            const remarks =
              daysDiff < 0
                ? `已上映${Math.abs(daysDiff)}天`
                : daysDiff === 0
                  ? '今日上映'
                  : `${daysDiff}天后上映`;

            return (
              <VideoCard
                key={`${release.id}-${release.releaseDate}`}
                source='upcoming_release'
                id={release.id}
                source_name='即将上映'
                from='douban'
                title={release.title}
                poster={release.cover || '/placeholder-poster.jpg'}
                year={release.releaseDate.split('-')[0]}
                type={release.type}
                remarks={remarks}
                releaseDate={release.releaseDate}
                query={release.title}
                episodes={
                  release.episodes || (release.type === 'tv' ? undefined : 1)
                }
              />
            );
          })}
        </ScrollableRow>
      )}
    </section>
  );
});

const MovieSection = memo(function MovieSection({
  error,
  items,
  loading,
  onRetry,
}: {
  error: string | null;
  items: DoubanMovieDetail[];
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className='mb-2 sm:mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle title='热门电影' icon={Film} iconColor='text-red-500' />
        <Link
          href='/douban?type=movie'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>
      {error && items.length === 0 && !loading ? (
        <SectionLoadError message={error} onRetry={onRetry} />
      ) : (
        <ScrollableRow enableVirtualization>
          {loading
            ? LoadingCards()
            : items.map((movie) => (
                <VideoCard
                  key={movie.id}
                  from='douban'
                  source='douban'
                  id={movie.id}
                  source_name='豆瓣'
                  title={movie.title}
                  poster={movie.poster}
                  douban_id={Number(movie.id)}
                  rate={movie.rate}
                  year={movie.year}
                  type='movie'
                />
              ))}
        </ScrollableRow>
      )}
    </section>
  );
});

const TvSection = memo(function TvSection({
  error,
  items,
  loading,
  onRetry,
}: {
  error: string | null;
  items: DoubanMovieDetail[];
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className='mb-2 sm:mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle title='热门剧集' icon={Tv} iconColor='text-primary-500' />
        <Link
          href='/douban?type=tv'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>
      {error && items.length === 0 && !loading ? (
        <SectionLoadError message={error} onRetry={onRetry} />
      ) : (
        <ScrollableRow enableVirtualization>
          {loading
            ? LoadingCards()
            : items.map((show) => (
                <VideoCard
                  key={show.id}
                  from='douban'
                  source='douban'
                  id={show.id}
                  source_name='豆瓣'
                  title={show.title}
                  poster={show.poster}
                  douban_id={Number(show.id)}
                  rate={show.rate}
                  year={show.year}
                  type='tv'
                />
              ))}
        </ScrollableRow>
      )}
    </section>
  );
});

const BangumiSection = memo(function BangumiSection({
  error,
  items,
  loading,
  onRetry,
}: {
  error: string | null;
  items: HomeBangumiItem[];
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className='mb-2 sm:mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='新番放送'
          icon={Calendar}
          iconColor='text-purple-500'
        />
        <Link
          href='/douban?type=anime'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>
      {error && items.length === 0 && !loading ? (
        <SectionLoadError message={error} onRetry={onRetry} />
      ) : (
        <ScrollableRow enableVirtualization>
          {loading
            ? LoadingCards()
            : items.map((anime) => (
                <VideoCard
                  key={anime.id}
                  from='douban'
                  source='bangumi'
                  id={anime.id.toString()}
                  source_name='Bangumi'
                  title={anime.name_cn || anime.name}
                  poster={anime.image || '/placeholder-poster.jpg'}
                  douban_id={anime.id}
                  rate={anime.score?.toFixed(1) || ''}
                  year={anime.air_date?.split('-')?.[0] || ''}
                  isBangumi
                />
              ))}
        </ScrollableRow>
      )}
    </section>
  );
});

const VarietySection = memo(function VarietySection({
  error,
  items,
  loading,
  onRetry,
}: {
  error: string | null;
  items: DoubanMovieDetail[];
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className='mb-2 sm:mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='热门综艺'
          icon={Sparkles}
          iconColor='text-pink-500'
        />
        <Link
          href='/douban?type=show'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>
      {error && items.length === 0 && !loading ? (
        <SectionLoadError message={error} onRetry={onRetry} />
      ) : (
        <ScrollableRow enableVirtualization>
          {loading
            ? LoadingCards()
            : items.map((show) => (
                <VideoCard
                  key={show.id}
                  from='douban'
                  source='douban'
                  id={show.id}
                  source_name='豆瓣'
                  title={show.title}
                  poster={show.poster}
                  douban_id={Number(show.id)}
                  rate={show.rate}
                  year={show.year}
                  type='variety'
                />
              ))}
        </ScrollableRow>
      )}
    </section>
  );
});

const ShortDramaSection = memo(function ShortDramaSection({
  error,
  items,
  loading,
  onRetry,
}: {
  error: string | null;
  items: ShortDramaItem[];
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className='mb-2 sm:mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='热门短剧'
          icon={Play}
          iconColor='text-orange-500'
        />
        <Link
          href='/shortdrama'
          className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='ml-1 h-4 w-4' />
        </Link>
      </div>
      {error && items.length === 0 && !loading ? (
        <SectionLoadError message={error} onRetry={onRetry} />
      ) : (
        <ScrollableRow enableVirtualization>
          {loading
            ? LoadingCards()
            : items.map((drama) => (
                <ShortDramaCard
                  key={drama.id}
                  drama={drama}
                  className='w-full'
                />
              ))}
        </ScrollableRow>
      )}
    </section>
  );
});

function HomeRecommendationSections({
  errors,
  hotMovies,
  hotShortDramas,
  hotTvShows,
  hotVarietyShows,
  loading,
  onUpcomingFilterChange,
  retry,
  today,
  todayAnimes,
  upcomingFilter,
  upcomingReleases,
}: HomeRecommendationSectionsProps) {
  return (
    <>
      {loading.upcoming ? (
        <UpcomingLoadingSection />
      ) : upcomingReleases.length > 0 ? (
        <UpcomingSection
          error={errors.upcoming}
          releases={upcomingReleases}
          filter={upcomingFilter}
          onFilterChange={onUpcomingFilterChange}
          onRetry={retry.upcoming}
          today={today}
        />
      ) : errors.upcoming ? (
        <UpcomingSection
          error={errors.upcoming}
          releases={[]}
          filter={upcomingFilter}
          onFilterChange={onUpcomingFilterChange}
          onRetry={retry.upcoming}
          today={today}
        />
      ) : null}

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <MovieSection
          error={errors.movies}
          items={hotMovies}
          loading={loading.movies}
          onRetry={retry.movies}
        />
      </DeferredSection>

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <TvSection
          error={errors.tv}
          items={hotTvShows}
          loading={loading.tv}
          onRetry={retry.tv}
        />
      </DeferredSection>

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <BangumiSection
          error={errors.bangumi}
          items={todayAnimes}
          loading={loading.bangumi}
          onRetry={retry.bangumi}
        />
      </DeferredSection>

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <VarietySection
          error={errors.variety}
          items={hotVarietyShows}
          loading={loading.variety}
          onRetry={retry.variety}
        />
      </DeferredSection>

      {(loading.shortDramas ||
        hotShortDramas.length > 0 ||
        errors.shortDramas) && (
        <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
          <ShortDramaSection
            error={errors.shortDramas}
            items={hotShortDramas}
            loading={loading.shortDramas}
            onRetry={retry.shortDramas}
          />
        </DeferredSection>
      )}
    </>
  );
}

export default memo(HomeRecommendationSections);
