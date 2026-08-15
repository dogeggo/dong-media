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
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  findNextHeroBannerCandidate,
  getHeroBannerCandidateKey,
} from '@/lib/hero-banner-selection';
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
  candidates?: BannerItem[];
  autoPlayInterval?: number;
  showControls?: boolean;
  showIndicators?: boolean;
  enableVideo?: boolean;
}

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
}

interface DoubanDetailResponse {
  list?: Array<{
    title?: string;
    poster?: string;
    backdrop?: string;
    plot_summary?: string;
    year?: string;
    rate?: string;
    trailerUrl?: string;
  }>;
}

type LowPriorityRequestInit = RequestInit & { priority?: 'low' };
type BannerItemDetails = Partial<BannerItem> | undefined;

const HERO_VIDEO_DELAY_MS = 4_000;
const CONSTRAINED_HERO_VIDEO_DELAY_MS = 8_000;
const HERO_DETAILS_DELAY_MS = 500;

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
  return processImageUrl(rawUrl || item.poster);
};

const hasHeroDetails = (item: BannerItem) =>
  Boolean(item.description && item.backdrop);

function BannerImage({
  src,
  alt,
  isBackdrop,
  isPriority,
  onPortrait,
}: {
  src: string;
  alt: string;
  isBackdrop: boolean;
  isPriority: boolean;
  onPortrait?: (src: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [useContain, setUseContain] = useState(!isBackdrop);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const aspectRatio = image.naturalWidth / Math.max(image.naturalHeight, 1);
    if (aspectRatio < 1 && onPortrait) {
      onPortrait(src);
      return;
    }
    setUseContain(aspectRatio < 1.25);
    setLoaded(true);
  };

  return (
    <div className='pointer-events-none absolute inset-0'>
      <Image
        src={src}
        alt={alt}
        fill
        className={
          useContain
            ? 'object-contain object-center sm:object-right'
            : 'object-cover object-center'
        }
        preload={isPriority}
        loading={isPriority ? undefined : 'lazy'}
        fetchPriority={isPriority ? 'high' : 'low'}
        quality={85}
        sizes='100vw'
        onLoad={handleLoad}
      />
      <div
        className={`pointer-events-none absolute inset-0 bg-gray-950 transition-opacity duration-150 motion-reduce:transition-none ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
      />
    </div>
  );
}

function BannerVideo({
  doubanId,
  isMuted,
  onReady,
}: {
  doubanId: number;
  isMuted: boolean;
  onReady: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  const handleCanPlay = () => {
    setLoaded(true);
    onReady();
  };

  return (
    <video
      ref={videoRef}
      className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 motion-reduce:transition-none ${
        loaded ? 'opacity-100' : 'opacity-0'
      }`}
      autoPlay
      muted={isMuted}
      loop
      playsInline
      preload='none'
      onCanPlay={handleCanPlay}
      onError={() => setLoaded(false)}
      src={`/api/video-proxy?id=${doubanId}&carousel=1`}
    />
  );
}

export default function HeroBanner({
  items,
  candidates,
  autoPlayInterval = 8000,
  showControls = true,
  showIndicators = true,
  enableVideo = true,
}: HeroBannerProps) {
  const [bannerItems, setBannerItems] = useState(items);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [detailsById, setDetailsById] = useState<
    Record<string, Partial<BannerItem>>
  >({});
  const [videoReadyId, setVideoReadyId] = useState<number | null>(null);
  const [videoPlayingId, setVideoPlayingId] = useState<number | null>(null);
  const detailRequestsRef = useRef<Map<string, Promise<BannerItemDetails>>>(
    new Map(),
  );
  const detailResultsRef = useRef<Map<string, Partial<BannerItem>>>(new Map());
  const loadedDetailIdsRef = useRef<Set<string>>(new Set());
  const rejectedItemKeysRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const transitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setBannerItems(items);
    rejectedItemKeysRef.current.clear();
  }, [items]);

  useEffect(() => {
    if (currentIndex >= bannerItems.length) setCurrentIndex(0);
  }, [bannerItems.length, currentIndex]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    },
    [],
  );

  const loadItemDetails = useCallback(
    (item: BannerItem, lowPriority: boolean, signal?: AbortSignal) => {
      const id = String(item.douban_id || item.id);
      if (!item.douban_id) {
        return Promise.resolve(undefined);
      }
      if (loadedDetailIdsRef.current.has(id)) {
        return Promise.resolve(detailResultsRef.current.get(id));
      }

      const existingRequest = detailRequestsRef.current.get(id);
      if (existingRequest) return existingRequest;

      const requestInit: LowPriorityRequestInit = { signal };
      if (lowPriority) requestInit.priority = 'low';

      const request = fetch(
        `/api/douban/details?id=${encodeURIComponent(String(item.douban_id))}`,
        requestInit,
      )
        .then(async (response) => {
          if (!response.ok) return;
          const result = (await response.json()) as DoubanDetailResponse;
          const detail = result.list?.[0];
          if (!detail) return;

          const itemDetails: Partial<BannerItem> = {
            title: detail.title || item.title,
            description: detail.plot_summary || item.description,
            poster: detail.poster || item.poster,
            backdrop: detail.backdrop || item.backdrop,
            year: detail.year || item.year,
            rate: detail.rate || item.rate,
            trailerUrl: detail.trailerUrl || item.trailerUrl,
          };
          detailResultsRef.current.set(id, itemDetails);
          loadedDetailIdsRef.current.add(id);
          if (!mountedRef.current) return itemDetails;
          setDetailsById((current) => ({
            ...current,
            [id]: itemDetails,
          }));
          return itemDetails;
        })
        // 详情加载失败时保留分类数据，不影响轮播和后续视频降级。
        .catch(() => undefined)
        .finally(() => {
          detailRequestsRef.current.delete(id);
        });

      detailRequestsRef.current.set(id, request);
      return request;
    },
    [],
  );

  useEffect(() => {
    const item = bannerItems[currentIndex];
    if (!item || hasHeroDetails(item)) return;
    void loadItemDetails(item, false);
  }, [bannerItems, currentIndex, loadItemDetails]);

  useEffect(() => {
    const controller = new AbortController();
    let delayTimer: number | null = null;
    let idleCallback: number | null = null;
    let scheduled = false;

    const loadRemainingDetails = async () => {
      for (const item of bannerItems.slice(1)) {
        if (controller.signal.aborted) return;
        if (!hasHeroDetails(item)) {
          await loadItemDetails(item, true, controller.signal);
        }
      }
    };

    const scheduleDetails = () => {
      if (scheduled || controller.signal.aborted || document.hidden) return;
      scheduled = true;
      delayTimer = window.setTimeout(() => {
        delayTimer = null;
        if ('requestIdleCallback' in window) {
          idleCallback = window.requestIdleCallback(
            () => void loadRemainingDetails(),
            { timeout: 2_500 },
          );
        } else {
          void loadRemainingDetails();
        }
      }, HERO_DETAILS_DELAY_MS);
    };

    const handleLoad = () => scheduleDetails();
    const handleVisibilityChange = () => {
      if (!document.hidden) scheduleDetails();
    };

    if (document.readyState === 'complete') scheduleDetails();
    else window.addEventListener('load', handleLoad, { once: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.abort();
      window.removeEventListener('load', handleLoad);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      if (idleCallback !== null) window.cancelIdleCallback(idleCallback);
    };
  }, [bannerItems, loadItemDetails]);

  const currentBaseItem = bannerItems[currentIndex];
  const currentItem = currentBaseItem
    ? {
        ...currentBaseItem,
        ...detailsById[String(currentBaseItem.douban_id || currentBaseItem.id)],
      }
    : undefined;

  useEffect(() => {
    if (!enableVideo || !currentItem?.douban_id) return;

    const doubanId = currentItem.douban_id;
    const connection = (
      navigator as Navigator & { connection?: NetworkInformation }
    ).connection;
    if (connection?.saveData) return;

    const constrainedNetwork =
      connection?.effectiveType === 'slow-2g' ||
      connection?.effectiveType === '2g';
    let delayTimer: number | null = null;
    let idleCallback: number | null = null;
    let scheduled = false;

    const scheduleVideo = () => {
      if (scheduled || document.hidden) return;
      scheduled = true;
      delayTimer = window.setTimeout(
        () => {
          delayTimer = null;
          const markReady = () => setVideoReadyId(doubanId);
          if ('requestIdleCallback' in window) {
            idleCallback = window.requestIdleCallback(markReady, {
              timeout: 5_000,
            });
          } else {
            markReady();
          }
        },
        constrainedNetwork
          ? CONSTRAINED_HERO_VIDEO_DELAY_MS
          : HERO_VIDEO_DELAY_MS,
      );
    };

    const handleLoad = () => scheduleVideo();
    const handleVisibilityChange = () => {
      if (!document.hidden) scheduleVideo();
    };

    if (document.readyState === 'complete') scheduleVideo();
    else window.addEventListener('load', handleLoad, { once: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('load', handleLoad);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      if (idleCallback !== null) window.cancelIdleCallback(idleCallback);
    };
  }, [currentItem?.douban_id, enableVideo]);

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
    if (isTransitioning || bannerItems.length === 0) return;
    setIsTransitioning(true);
    setCurrentIndex((index) => (index + 1) % bannerItems.length);
    finishTransitionLater();
  }, [bannerItems.length, finishTransitionLater, isTransitioning]);

  const handlePrev = useCallback(() => {
    if (isTransitioning || bannerItems.length === 0) return;
    setIsTransitioning(true);
    setCurrentIndex(
      (index) => (index - 1 + bannerItems.length) % bannerItems.length,
    );
    finishTransitionLater();
  }, [bannerItems.length, finishTransitionLater, isTransitioning]);

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
    itemsLength: bannerItems.length,
    onNext: handleNext,
  });

  const swipeHandlers = useSwipeGesture({
    onSwipeLeft: handleNext,
    onSwipeRight: handlePrev,
  });

  const handlePortraitImage = useCallback(
    async (item: BannerItem, rejectedImageUrl: string) => {
      if (!candidates) return;

      // 分类数据通常只有海报；先等待详情中的横版背景图，避免过早跳过。
      if (!hasHeroDetails(item)) {
        const details = await loadItemDetails(item, false);
        if (!mountedRef.current) return;
        if (
          details &&
          getImageUrl({ ...item, ...details }) !== rejectedImageUrl
        ) {
          return;
        }
      }

      const rejectedKey = getHeroBannerCandidateKey(item);
      rejectedItemKeysRef.current.add(rejectedKey);
      setBannerItems((currentItems) => {
        const itemIndex = currentItems.findIndex(
          (current) => getHeroBannerCandidateKey(current) === rejectedKey,
        );
        if (itemIndex < 0) return currentItems;

        const replacement = findNextHeroBannerCandidate(
          item,
          currentItems,
          candidates,
          rejectedItemKeysRef.current,
        );
        if (!replacement) {
          return currentItems.filter((_, index) => index !== itemIndex);
        }

        return currentItems.map((current, index) =>
          index === itemIndex ? replacement : current,
        );
      });
    },
    [candidates, loadItemDetails],
  );

  if (!currentItem) return null;

  const currentImageUrl = getImageUrl(currentItem);
  const shouldMountVideo =
    enableVideo && videoReadyId === currentItem.douban_id;
  const isCurrentVideoPlaying = videoPlayingId === currentItem.douban_id;
  return (
    <div
      className='group relative h-[50vh] w-full overflow-hidden sm:h-[55vh] md:h-[60vh]'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...swipeHandlers}
    >
      <div className='pointer-events-none absolute inset-0'>
        <BannerImage
          key={currentImageUrl}
          src={currentImageUrl}
          alt={currentItem.title}
          isBackdrop={Boolean(currentItem.backdrop)}
          isPriority={currentIndex === 0}
          onPortrait={
            candidates
              ? (src) => void handlePortraitImage(currentItem, src)
              : undefined
          }
        />

        {shouldMountVideo && currentItem.douban_id && (
          <BannerVideo
            key={currentItem.douban_id}
            doubanId={currentItem.douban_id}
            isMuted={isMuted}
            onReady={() => setVideoPlayingId(currentItem.douban_id!)}
          />
        )}

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
              prefetch={false}
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
              prefetch={false}
              className='flex transform items-center gap-2 rounded border border-white/50 bg-white/30 px-6 py-2.5 text-base font-bold text-white shadow-xl backdrop-blur-md transition-all hover:scale-105 hover:bg-white/40 active:scale-95 sm:px-8 sm:py-3 sm:text-lg md:px-10 md:py-4 md:text-xl'
            >
              <Info className='h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7' />
              <span>更多信息</span>
            </Link>
          </div>
        </div>
      </div>

      {isCurrentVideoPlaying && (
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

      {showControls && bannerItems.length > 1 && (
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

      {showIndicators && bannerItems.length > 1 && (
        <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 sm:bottom-6'>
          {bannerItems.map((item, index) => (
            <button
              key={getHeroBannerCandidateKey(item)}
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
          {currentIndex + 1} / {bannerItems.length}
        </div>
      </div>
    </div>
  );
}
