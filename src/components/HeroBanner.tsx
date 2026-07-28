'use client';

import {
  ChevronLeft,
  ChevronRight,
  Info,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { processImageUrl } from '@/lib/image-url';

import { useAutoplay } from './hooks/useAutoplay';
import { useSwipeGesture } from './hooks/useSwipeGesture';

interface BannerItem {
  id: string | number;
  title: string;
  description?: string;
  poster: string;
  backdrop?: string;
  year?: string;
  rate?: string;
  douban_id?: number;
  type?: string;
  trailerUrl?: string;
}

interface HeroBannerProps {
  items: BannerItem[];
  autoPlayInterval?: number;
  showControls?: boolean;
  showIndicators?: boolean;
  enableVideo?: boolean;
}

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
}

const MAX_VIDEO_RETRIES = 4;
const VIDEO_RETRY_DELAY_MS = 5000;

const getHDBackdrop = (url?: string) => {
  if (!url) return url;
  return url
    .replace('/view/photo/s/', '/view/photo/l/')
    .replace('/view/photo/m/', '/view/photo/l/')
    .replace('/view/photo/sqxs/', '/view/photo/l/')
    .replace('/s_ratio_poster/', '/l_ratio_poster/')
    .replace('/m_ratio_poster/', '/l_ratio_poster/');
};

const getImageUrl = (item: BannerItem) => {
  const rawUrl = getHDBackdrop(item.backdrop || item.poster);
  return rawUrl ? processImageUrl(rawUrl) : processImageUrl(item.poster);
};

function BannerImage({
  src,
  alt,
  isPriority,
}: {
  src: string;
  alt: string;
  isPriority: boolean;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className='pointer-events-none absolute inset-0'>
      {!loaded && (
        <div className='pointer-events-none absolute inset-0 bg-black/10 motion-safe:animate-pulse' />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover object-center transition-opacity duration-700 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        priority={isPriority}
        loading={isPriority ? 'eager' : 'lazy'}
        quality={80}
        sizes='100vw'
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function BannerVideo({
  doubanId,
  isMuted,
}: {
  doubanId: number;
  isMuted: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  const handleError = () => {
    setLoaded(false);
    if (retryAttempt >= MAX_VIDEO_RETRIES || retryTimerRef.current !== null) {
      return;
    }

    // carousel 首次请求可能返回 503 并在服务端后台预热。延迟重试，
    // 不在主线程轮询，也不把完整视频复制进 Cache Storage。
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setRetryAttempt((attempt) => attempt + 1);
    }, VIDEO_RETRY_DELAY_MS);
  };

  return (
    <video
      key={retryAttempt}
      ref={videoRef}
      className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
        loaded ? 'opacity-100' : 'opacity-0'
      }`}
      autoPlay
      muted={isMuted}
      loop
      playsInline
      preload='metadata'
      onCanPlay={() => setLoaded(true)}
      onError={handleError}
      src={`/api/video-proxy?id=${doubanId}&carousel=1&attempt=${retryAttempt}`}
    />
  );
}

export default function HeroBanner({
  items,
  autoPlayInterval = 8000,
  showControls = true,
  showIndicators = true,
  enableVideo = false,
}: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (currentIndex >= items.length) setCurrentIndex(0);
  }, [currentIndex, items.length]);

  useEffect(() => {
    setVideoReady(false);
    if (!enableVideo || !items[currentIndex]?.douban_id) return;

    const connection = (
      navigator as Navigator & { connection?: NetworkInformation }
    ).connection;
    const isConstrainedNetwork =
      connection?.saveData === true ||
      connection?.effectiveType === 'slow-2g' ||
      connection?.effectiveType === '2g';
    const delay = isConstrainedNetwork ? 8000 : 2500;
    const timerId = window.setTimeout(() => setVideoReady(true), delay);

    return () => window.clearTimeout(timerId);
  }, [currentIndex, enableVideo, items]);

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    },
    [],
  );

  const finishTransitionLater = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setIsTransitioning(false);
    }, 800);
  }, []);

  const handleNext = useCallback(() => {
    if (isTransitioning || items.length === 0) return;
    setIsTransitioning(true);
    setCurrentIndex((index) => (index + 1) % items.length);
    finishTransitionLater();
  }, [finishTransitionLater, isTransitioning, items.length]);

  const handlePrev = useCallback(() => {
    if (isTransitioning || items.length === 0) return;
    setIsTransitioning(true);
    setCurrentIndex((index) => (index - 1 + items.length) % items.length);
    finishTransitionLater();
  }, [finishTransitionLater, isTransitioning, items.length]);

  const handleIndicatorClick = (index: number) => {
    if (isTransitioning || index === currentIndex) return;
    setIsTransitioning(true);
    setCurrentIndex(index);
    finishTransitionLater();
  };

  useAutoplay({
    currentIndex,
    isHovered,
    autoPlayInterval,
    itemsLength: items.length,
    onNext: handleNext,
  });

  const swipeHandlers = useSwipeGesture({
    onSwipeLeft: handleNext,
    onSwipeRight: handlePrev,
  });

  if (items.length === 0) return null;

  const currentItem = items[currentIndex];
  const mediaIndices = Array.from(
    new Set([
      (currentIndex - 1 + items.length) % items.length,
      currentIndex,
      (currentIndex + 1) % items.length,
    ]),
  );
  const hasVideo = enableVideo && !!currentItem.douban_id;

  return (
    <div
      className='group relative h-[50vh] w-full overflow-hidden sm:h-[55vh] md:h-[60vh]'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...swipeHandlers}
    >
      <div className='pointer-events-none absolute inset-0'>
        {mediaIndices.map((index) => {
          const item = items[index];
          const isCurrent = index === currentIndex;

          return (
            <div
              key={item.id}
              className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
                isCurrent ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <BannerImage
                src={getImageUrl(item)}
                alt={item.title}
                isPriority={isCurrent}
              />

              {isCurrent && videoReady && item.douban_id && (
                <BannerVideo doubanId={item.douban_id} isMuted={isMuted} />
              )}
            </div>
          );
        })}

        <div className='absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/80' />
        <div className='absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent' />
      </div>

      <div className='absolute right-0 bottom-0 left-0 px-4 pb-12 sm:px-8 sm:pb-16 md:px-12 md:pb-20 lg:px-16 lg:pb-24 xl:px-20'>
        <div className='space-y-3 sm:space-y-4 md:space-y-5 lg:space-y-6'>
          <h1 className='text-3xl leading-tight font-bold break-words text-white drop-shadow-2xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl'>
            {currentItem.title}
          </h1>

          <div className='flex flex-wrap items-center gap-3 text-sm sm:gap-4 sm:text-base md:text-lg'>
            {currentItem.rate && (
              <div className='flex items-center gap-1.5 rounded bg-yellow-500/90 px-2.5 py-1 backdrop-blur-sm'>
                <span className='font-bold text-white'>★</span>
                <span className='font-bold text-white'>{currentItem.rate}</span>
              </div>
            )}
            {currentItem.year && (
              <span className='font-semibold text-white/90 drop-shadow-md'>
                {currentItem.year}
              </span>
            )}
            {currentItem.type && (
              <span className='rounded border border-white/30 bg-white/20 px-3 py-1 font-medium text-white/90 backdrop-blur-sm'>
                {currentItem.type === 'movie'
                  ? '电影'
                  : currentItem.type === 'tv'
                    ? '剧集'
                    : currentItem.type === 'variety'
                      ? '综艺'
                      : currentItem.type === 'shortdrama'
                        ? '短剧'
                        : currentItem.type === 'anime'
                          ? '动漫'
                          : '剧集'}
              </span>
            )}
          </div>

          {currentItem.description && (
            <p className='line-clamp-3 max-w-xl text-sm leading-relaxed text-white/90 drop-shadow-lg sm:text-base md:text-lg lg:text-xl'>
              {currentItem.description}
            </p>
          )}

          <div className='flex gap-3 pt-2 sm:gap-4'>
            <Link
              href={
                currentItem.type === 'shortdrama'
                  ? `/play?title=${encodeURIComponent(currentItem.title)}`
                  : `/play?title=${encodeURIComponent(currentItem.title)}${currentItem.year ? `&year=${currentItem.year}` : ''}${currentItem.douban_id ? `&douban_id=${currentItem.douban_id}` : ''}${currentItem.type ? `&stype=${currentItem.type}` : ''}`
              }
              className='flex transform items-center gap-2 rounded bg-white px-6 py-2.5 text-base font-bold text-black shadow-xl transition-all hover:scale-105 hover:bg-white/90 active:scale-95 sm:px-8 sm:py-3 sm:text-lg md:px-10 md:py-4 md:text-xl'
            >
              <Play
                className='h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7'
                fill='currentColor'
              />
              <span>播放</span>
            </Link>
            <Link
              href={
                currentItem.type === 'shortdrama'
                  ? '/shortdrama'
                  : `/douban?type=${
                      currentItem.type === 'variety'
                        ? 'show'
                        : currentItem.type || 'movie'
                    }`
              }
              className='flex transform items-center gap-2 rounded border border-white/50 bg-white/30 px-6 py-2.5 text-base font-bold text-white shadow-xl backdrop-blur-md transition-all hover:scale-105 hover:bg-white/40 active:scale-95 sm:px-8 sm:py-3 sm:text-lg md:px-10 md:py-4 md:text-xl'
            >
              <Info className='h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7' />
              <span>更多信息</span>
            </Link>
          </div>
        </div>
      </div>

      {hasVideo && (
        <button
          onClick={() => setIsMuted((muted) => !muted)}
          className='absolute right-4 bottom-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-black/50 text-white backdrop-blur-sm transition-all hover:bg-black/70 sm:right-8 sm:bottom-8 sm:h-12 sm:w-12 md:right-12 lg:right-16'
          aria-label={isMuted ? '取消静音' : '静音'}
        >
          {isMuted ? (
            <VolumeX className='h-5 w-5 sm:h-6 sm:w-6' />
          ) : (
            <Volume2 className='h-5 w-5 sm:h-6 sm:w-6' />
          )}
        </button>
      )}

      {showControls && items.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            className='absolute top-1/2 left-4 hidden h-12 w-12 -translate-y-1/2 transform items-center justify-center rounded-full border border-white/30 bg-black/50 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:scale-110 hover:bg-black/70 md:flex lg:left-8 lg:h-14 lg:w-14'
            aria-label='上一张'
          >
            <ChevronLeft className='h-7 w-7 lg:h-8 lg:w-8' />
          </button>
          <button
            onClick={handleNext}
            className='absolute top-1/2 right-4 hidden h-12 w-12 -translate-y-1/2 transform items-center justify-center rounded-full border border-white/30 bg-black/50 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:scale-110 hover:bg-black/70 md:flex lg:right-8 lg:h-14 lg:w-14'
            aria-label='下一张'
          >
            <ChevronRight className='h-7 w-7 lg:h-8 lg:w-8' />
          </button>
        </>
      )}

      {showIndicators && items.length > 1 && (
        <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 sm:bottom-6'>
          {items.map((item, index) => (
            <button
              key={item.id}
              onClick={() => handleIndicatorClick(index)}
              className={`h-1 rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'w-8 bg-white shadow-lg sm:w-10'
                  : 'w-2 bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`跳转到第 ${index + 1} 张`}
            />
          ))}
        </div>
      )}

      <div className='absolute top-4 right-4 sm:top-6 sm:right-8 md:top-8 md:right-12'>
        <div className='rounded border-2 border-white/70 bg-black/60 px-2 py-1 text-xs font-bold text-white backdrop-blur-sm sm:text-sm'>
          {currentIndex + 1} / {items.length}
        </div>
      </div>
    </div>
  );
}
