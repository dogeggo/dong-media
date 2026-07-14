'use client';

import { Calendar, ChevronRight, Film, Play, Sparkles, Tv } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { memo, useMemo } from 'react';

import type { BangumiCalendarData } from '@/lib/bangumi-api';
import type {
  DoubanMovieDetail,
  ReleaseCalendarItem,
  ShortDramaItem,
} from '@/lib/types';

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

type BangumiItem = BangumiCalendarData['items'][number];
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
  hotMovies: DoubanMovieDetail[];
  hotShortDramas: ShortDramaItem[];
  hotTvShows: DoubanMovieDetail[];
  hotVarietyShows: DoubanMovieDetail[];
  loading: SectionLoadingState;
  onUpcomingFilterChange: (filter: UpcomingFilter) => void;
  shortDramasError: boolean;
  today: Date;
  todayAnimes: BangumiItem[];
  upcomingFilter: UpcomingFilter;
  upcomingReleases: ReleaseCalendarItem[];
}

function LoadingCards() {
  return SKELETON_ITEMS.map((index) => <SkeletonCard key={index} />);
}

const UpcomingSection = memo(function UpcomingSection({
  filter,
  onFilterChange,
  releases,
  today,
}: {
  filter: UpcomingFilter;
  onFilterChange: (filter: UpcomingFilter) => void;
  releases: ReleaseCalendarItem[];
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
    </section>
  );
});

const MovieSection = memo(function MovieSection({
  items,
  loading,
}: {
  items: DoubanMovieDetail[];
  loading: boolean;
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
    </section>
  );
});

const TvSection = memo(function TvSection({
  items,
  loading,
}: {
  items: DoubanMovieDetail[];
  loading: boolean;
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
    </section>
  );
});

const BangumiSection = memo(function BangumiSection({
  items,
  loading,
}: {
  items: BangumiItem[];
  loading: boolean;
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
                poster={
                  anime.images?.large ||
                  anime.images?.common ||
                  anime.images?.medium ||
                  anime.images?.small ||
                  anime.images?.grid ||
                  '/placeholder-poster.jpg'
                }
                douban_id={anime.id}
                rate={anime.rating?.score?.toFixed(1) || ''}
                year={anime.air_date?.split('-')?.[0] || ''}
                isBangumi
              />
            ))}
      </ScrollableRow>
    </section>
  );
});

const VarietySection = memo(function VarietySection({
  items,
  loading,
}: {
  items: DoubanMovieDetail[];
  loading: boolean;
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
    </section>
  );
});

const ShortDramaSection = memo(function ShortDramaSection({
  items,
  loading,
}: {
  items: ShortDramaItem[];
  loading: boolean;
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
      <ScrollableRow enableVirtualization>
        {loading
          ? LoadingCards()
          : items.map((drama) => (
              <ShortDramaCard key={drama.id} drama={drama} className='w-full' />
            ))}
      </ScrollableRow>
    </section>
  );
});

function HomeRecommendationSections({
  hotMovies,
  hotShortDramas,
  hotTvShows,
  hotVarietyShows,
  loading,
  onUpcomingFilterChange,
  shortDramasError,
  today,
  todayAnimes,
  upcomingFilter,
  upcomingReleases,
}: HomeRecommendationSectionsProps) {
  return (
    <>
      {loading.upcoming ? (
        <div
          aria-hidden='true'
          className={`${SECTION_PLACEHOLDER} w-full`}
          data-upcoming-placeholder='true'
        />
      ) : upcomingReleases.length > 0 ? (
        <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
          <UpcomingSection
            releases={upcomingReleases}
            filter={upcomingFilter}
            onFilterChange={onUpcomingFilterChange}
            today={today}
          />
        </DeferredSection>
      ) : null}

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <MovieSection items={hotMovies} loading={loading.movies} />
      </DeferredSection>

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <TvSection items={hotTvShows} loading={loading.tv} />
      </DeferredSection>

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <BangumiSection items={todayAnimes} loading={loading.bangumi} />
      </DeferredSection>

      <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
        <VarietySection items={hotVarietyShows} loading={loading.variety} />
      </DeferredSection>

      {!shortDramasError && (
        <DeferredSection placeholderClassName={SECTION_PLACEHOLDER}>
          <ShortDramaSection
            items={hotShortDramas}
            loading={loading.shortDramas}
          />
        </DeferredSection>
      )}
    </>
  );
}

export default memo(HomeRecommendationSections);
