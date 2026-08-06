'use client';

import { Heart, Play, Star } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { memo, startTransition, useCallback, useEffect, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { processImageUrl } from '@/lib/image-url';
import { ShortDramaItem } from '@/lib/types';

import { POSTER_FALLBACK } from '@/components/CardPoster';

import { useNavigationLoading } from '@/contexts/NavigationLoadingContext';

interface ShortDramaCardProps {
  drama: ShortDramaItem;
  showDescription?: boolean;
  className?: string;
  priority?: boolean;
}

const ShortDramaPoster = memo(function ShortDramaPoster({
  alt,
  priority,
  src,
}: {
  alt: string;
  priority: boolean;
  src: string;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);

  const markImageLoaded = useCallback(() => {
    startTransition(() => {
      setImageLoaded((loaded) => (loaded ? loaded : true));
    });
  }, []);

  return (
    <>
      <div
        className='pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:animate-[card-shimmer_2.5s_ease-in-out_infinite] motion-reduce:animate-none'
        style={{
          background:
            'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.15) 45%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.15) 55%, transparent 70%)',
          backgroundSize: '200% 100%',
        }}
      />

      <Image
        src={src}
        alt={alt}
        fill
        sizes='(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw'
        className={`pointer-events-none select-none object-cover transition-all duration-700 ease-out ${
          imageLoaded
            ? 'scale-100 opacity-100 blur-0 group-hover:scale-105'
            : 'scale-105 opacity-0 blur-md'
        }`}
        preload={priority}
        loading={priority ? undefined : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        quality={75}
        decoding='async'
        draggable={false}
        onLoad={markImageLoaded}
        onError={(event) => {
          event.currentTarget.src = POSTER_FALLBACK;
          markImageLoaded();
        }}
      />
    </>
  );
});

function ShortDramaCard({
  drama,
  showDescription = false,
  className = '',
  priority = false,
}: ShortDramaCardProps) {
  const router = useRouter();
  const { startNavigation } = useNavigationLoading();
  // 直接使用 props 中的 episode_count，不再尝试异步获取真实集数
  const realEpisodeCount = drama.episode_count;
  const showEpisodeCount = drama.episode_count > 1;
  const [favorited, setFavorited] = useState(false); // 收藏状态
  // 🚀 性能优化：延迟加载收藏状态
  const [shouldCheckStatus, setShouldCheckStatus] = useState(false);

  // 短剧的source固定为shortdrama
  const source = 'shortdrama';
  const id = drama.id.toString(); // 转换为字符串

  // 检查收藏状态
  useEffect(() => {
    if (!shouldCheckStatus) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(source, id);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    };

    fetchFavoriteStatus();

    // 监听收藏状态更新事件
    const storageKey = generateStorageKey(source, id);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      },
    );

    return unsubscribe;
  }, [source, id, shouldCheckStatus]);

  // 处理收藏切换
  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        if (favorited) {
          // 取消收藏
          await deleteFavorite(source, id);
          setFavorited(false);
        } else {
          // 添加收藏
          await saveFavorite(source, id, {
            title: drama.name,
            source_name: '短剧',
            year: '',
            cover: drama.cover,
            total_episodes: realEpisodeCount,
            save_time: Date.now(),
            search_title: drama.name,
          });
          setFavorited(true);
        }
      } catch (err) {
        console.error('切换收藏状态失败:', err);
      }
    },
    [favorited, source, id, drama.name, drama.cover, realEpisodeCount],
  );

  const formatUpdateTime = (updateTime: string) => {
    try {
      const date = new Date(updateTime);
      return date.toLocaleDateString('zh-CN');
    } catch {
      return updateTime;
    }
  };

  const handleClick = useCallback(() => {
    startNavigation(drama.name);
    router.push(`/play?title=${encodeURIComponent(drama.name)}`);
  }, [drama.name, startNavigation, router]);

  return (
    <div
      className={`group relative ${className} transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-30 hover:shadow-2xl`}
      onMouseEnter={() => setShouldCheckStatus(true)}
      onTouchStart={() => setShouldCheckStatus(true)}
      onFocus={() => setShouldCheckStatus(true)}
    >
      <div onClick={handleClick} className='block cursor-pointer'>
        {/* 封面图片 */}
        <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
          <ShortDramaPoster
            key={drama.cover}
            src={processImageUrl(drama.cover)}
            alt={drama.name}
            priority={priority}
          />

          {/* 悬浮播放按钮 - 玻璃态效果 */}
          <div className='absolute inset-0 flex items-center justify-center bg-linear-to-t from-black/80 via-black/20 to-transparent backdrop-blur-[2px] opacity-0 transition-all duration-300 group-hover:opacity-100 pointer-events-none'>
            <div className='flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-110'>
              <Play className='h-5 w-5 ml-0.5' fill='currentColor' />
            </div>
          </div>

          {/* 集数标识 - Netflix 统一风格 - 只在集数>1时显示 */}
          {showEpisodeCount && (
            <div className='absolute top-2 left-2 flex items-center overflow-hidden rounded-md shadow-lg transition-all duration-300 ease-out group-hover:scale-105 bg-black/70 backdrop-blur-sm px-2 py-0.5'>
              <span className='flex items-center text-[10px] font-medium text-white/80'>
                {realEpisodeCount} 集
              </span>
            </div>
          )}

          {/* 评分 - 使用vote_average字段 */}
          {drama.vote_average && drama.vote_average > 0 && (
            <div className='absolute top-2 right-2 flex items-center rounded-lg bg-linear-to-br from-yellow-400 to-orange-500 px-2.5 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-sm ring-2 ring-white/30 transition-all duration-300 group-hover:scale-110'>
              <Star className='h-3 w-3 mr-1 fill-current' />
              {drama.vote_average.toFixed(1)}
            </div>
          )}

          {/* 收藏按钮 - 右下角 */}
          <button
            onClick={handleToggleFavorite}
            className='absolute bottom-2 right-2 h-8 w-8 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm opacity-0 transition-all duration-300 group-hover:opacity-100 hover:scale-110 hover:bg-black/70 z-20'
            aria-label={favorited ? '取消收藏' : '添加收藏'}
          >
            <Heart
              className={`h-4 w-4 transition-all duration-300 ${
                favorited
                  ? 'fill-red-500 text-red-500 scale-110'
                  : 'text-white hover:text-red-400'
              }`}
            />
          </button>
        </div>

        {/* 信息区域 */}
        <div className='mt-2 space-y-1.5'>
          <h3 className='text-sm font-semibold text-gray-900 dark:text-white line-clamp-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-linear-to-r group-hover:from-primary-600 group-hover:to-purple-600 dark:group-hover:from-primary-400 dark:group-hover:to-purple-400 transition-all duration-300'>
            {drama.name}
          </h3>

          {/* 演员信息 */}
          {drama.author && (
            <div className='flex items-center gap-1.5 text-xs'>
              <div className='flex items-center gap-1 px-2 py-0.5 rounded-full bg-linear-to-r from-primary-50 to-indigo-50 dark:from-primary-900/20 dark:to-indigo-900/20 border border-primary-200/50 dark:border-primary-700/50'>
                <svg
                  className='w-3 h-3 text-primary-600 dark:text-primary-400'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth='2'
                    d='M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
                  ></path>
                </svg>
                <span className='text-primary-700 dark:text-primary-300 font-medium line-clamp-1'>
                  {drama.author}
                </span>
              </div>
            </div>
          )}

          <div className='flex items-center gap-1.5 text-xs'>
            <div className='flex items-center gap-1 px-2 py-0.5 rounded-full bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200/50 dark:border-green-700/50'>
              <svg
                className='w-3 h-3 text-green-600 dark:text-green-400'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                ></path>
              </svg>
              <span className='text-green-700 dark:text-green-300 font-medium'>
                {formatUpdateTime(drama.update_time)}
              </span>
            </div>
          </div>

          {/* 描述信息（可选） */}
          {showDescription && drama.description && (
            <p className='text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1'>
              {drama.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ShortDramaCard);
