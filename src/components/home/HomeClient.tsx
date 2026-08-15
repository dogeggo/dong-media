/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
} from '@/lib/db.client';
import { getCurrentUserDataScope, userQueryKeys } from '@/lib/user-query-keys';
import type { InitialHomeRecommendations } from '@/hooks/useHomeRecommendations';
import { useHomeRecommendations } from '@/hooks/useHomeRecommendations';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import ContinueWatching from '@/components/ContinueWatching';
import HeroBanner from '@/components/HeroBanner';
import HomeRecommendationSections from '@/components/home/HomeRecommendationSections';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import SkeletonCard from '@/components/SkeletonCard';

// 收藏夹按需加载重型卡片；首页推荐行在独立 Section 组件中按需加载。
const VideoCard = dynamic(() => import('@/components/VideoCard'), {
  ssr: false,
  loading: () => <SkeletonCard />,
});

const MemoizedHeroBanner = memo(HeroBanner);

// 合并首页状态；具体推荐区域通过 memo 组件建立独立渲染边界。
interface HomeState {
  activeTab: 'home' | 'favorites';
  username: string;
  showAnnouncement: boolean;
}

type HomeAction =
  | { type: 'SET_ACTIVE_TAB'; payload: 'home' | 'favorites' }
  | { type: 'SET_USERNAME'; payload: string }
  | { type: 'SET_SHOW_ANNOUNCEMENT'; payload: boolean };

const homeReducer = (state: HomeState, action: HomeAction): HomeState => {
  switch (action.type) {
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    case 'SET_USERNAME':
      return { ...state, username: action.payload };
    case 'SET_SHOW_ANNOUNCEMENT':
      return { ...state, showAnnouncement: action.payload };
    default:
      return state;
  }
};

interface HomeClientProps {
  recommendations: Promise<InitialHomeRecommendations>;
}

export default function HomeClient({ recommendations }: HomeClientProps) {
  const initialRecommendations = use(recommendations);
  const { announcement } = useSite();
  const {
    errors: recommendationErrors,
    hotAnime,
    hotMovies,
    hotShortDramas,
    hotTvShows,
    hotVarietyShows,
    loading,
    retry: retryRecommendation,
    todayAnimes,
    upcomingReleases,
  } = useHomeRecommendations(initialRecommendations);
  const [state, dispatch] = useReducer(homeReducer, {
    activeTab: 'home',
    username: '',
    showAnnouncement: false,
  });

  const { activeTab, username, showAnnouncement } = state;

  // 🎯 优化：缓存今天的日期（用于上映日期计算）
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []); // 空依赖，只在组件挂载时计算一次

  const { heroCandidates, heroItems } = useMemo(() => {
    const mapCategory = (
      categoryItems: typeof hotMovies,
      type: 'anime' | 'movie' | 'tv' | 'variety',
    ) =>
      categoryItems.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.poster,
        backdrop: item.backdrop,
        trailerUrl: item.trailerUrl,
        description: item.plot_summary,
        year: item.year,
        rate: item.rate,
        douban_id: Number(item.id),
        type,
      }));

    const categories = [
      { items: mapCategory(hotMovies, 'movie'), limit: 2 },
      { items: mapCategory(hotTvShows, 'tv'), limit: 2 },
      { items: mapCategory(hotVarietyShows, 'variety'), limit: 1 },
      { items: mapCategory(hotAnime, 'anime'), limit: 1 },
    ];

    return {
      heroCandidates: categories.flatMap((category) => category.items),
      heroItems: categories.flatMap((category) =>
        category.items.slice(0, category.limit),
      ),
    };
  }, [hotAnime, hotMovies, hotTvShows, hotVarietyShows]);

  // 合并初始化逻辑 - 优化性能，减少重渲染
  useEffect(() => {
    // 获取用户名
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo?.username) {
      dispatch({ type: 'SET_USERNAME', payload: authInfo.username });
    }

    // 读取清空确认设置
    if (typeof window !== 'undefined') {
      const savedRequireClearConfirmation = localStorage.getItem(
        'requireClearConfirmation',
      );
      if (savedRequireClearConfirmation !== null) {
        setRequireClearConfirmation(JSON.parse(savedRequireClearConfirmation));
      }
    }

    // 检查公告弹窗状态
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        dispatch({ type: 'SET_SHOW_ANNOUNCEMENT', payload: true });
      } else {
        dispatch({
          type: 'SET_SHOW_ANNOUNCEMENT',
          payload: Boolean(!hasSeenAnnouncement && announcement),
        });
      }
    }
  }, [announcement]);

  const userDataScope = getCurrentUserDataScope();

  // 🚀 TanStack Query - 使用 useQuery 获取收藏数据（自动缓存，跨页面持久化）
  const { data: allFavorites = {} } = useQuery({
    queryKey: userQueryKeys.favorites(userDataScope),
    queryFn: () => getAllFavorites(),
    enabled: activeTab === 'favorites',
    staleTime: 5 * 60 * 1000, // 5分钟内数据保持新鲜
    gcTime: 10 * 60 * 1000, // 10分钟后垃圾回收
  });

  // 🚀 TanStack Query - 使用 useQuery 获取播放记录（自动缓存，跨页面持久化）
  const { data: allPlayRecords = {} } = useQuery({
    queryKey: userQueryKeys.playRecords(userDataScope),
    queryFn: () => getAllPlayRecords(),
    enabled: activeTab === 'favorites',
    staleTime: 5 * 60 * 1000, // 5分钟内数据保持新鲜
    gcTime: 10 * 60 * 1000, // 10分钟后垃圾回收
  });

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
    origin?: 'vod' | 'live';
    type?: string;
    releaseDate?: string;
    remarks?: string;
  };

  // 🚀 TanStack Query - 使用 useMemo 计算收藏列表（自动响应数据变化）
  const favoriteItems = useMemo(() => {
    // 根据保存时间排序（从近到远）
    return Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
          origin: fav?.origin,
          type: fav?.type,
          releaseDate: fav?.releaseDate,
          remarks: fav?.remarks,
        } as FavoriteItem;
      });
  }, [allFavorites, allPlayRecords]);

  const [favoriteFilter, setFavoriteFilter] = useState<
    'all' | 'movie' | 'tv' | 'anime' | 'shortdrama' | 'live' | 'variety'
  >('all');
  const [favoriteSortBy, setFavoriteSortBy] = useState<
    'recent' | 'title' | 'rating'
  >('recent');
  const [upcomingFilter, setUpcomingFilter] = useState<'all' | 'movie' | 'tv'>(
    'all',
  );
  const handleUpcomingFilterChange = useCallback(
    (filter: 'all' | 'movie' | 'tv') => setUpcomingFilter(filter),
    [],
  );
  const [showClearFavoritesDialog, setShowClearFavoritesDialog] =
    useState(false);
  const [requireClearConfirmation, setRequireClearConfirmation] =
    useState(false);

  // 🎯 优化：缓存收藏夹统计信息计算
  const favoriteStats = useMemo(() => {
    if (favoriteItems.length === 0) return null;

    return {
      total: favoriteItems.length,
      movie: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'movie';
        if (item.source === 'shortdrama' || item.source_name === '短剧')
          return false;
        if (item.source === 'bangumi') return false;
        if (item.origin === 'live') return false;
        return item.episodes === 1;
      }).length,
      tv: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'tv';
        if (item.source === 'shortdrama' || item.source_name === '短剧')
          return false;
        if (item.source === 'bangumi') return false;
        if (item.origin === 'live') return false;
        return item.episodes > 1;
      }).length,
      anime: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'anime';
        return item.source === 'bangumi';
      }).length,
      shortdrama: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'shortdrama';
        return item.source === 'shortdrama' || item.source_name === '短剧';
      }).length,
      live: favoriteItems.filter((item) => item.origin === 'live').length,
      variety: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'variety';
        return false;
      }).length,
    };
  }, [favoriteItems]);

  const handleClearFavorites = async () => {
    await clearAllFavorites();
  };

  const handleCloseAnnouncement = (announcement: string) => {
    dispatch({ type: 'SET_SHOW_ANNOUNCEMENT', payload: false });
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  return (
    <PageLayout>
      <div className='overflow-visible sm:pd-45 sm:pb-0 md:pb-safe-bottom'>
        {/* 顶部 Tab 切换 - AI 按钮已移至右上角导航栏 */}
        <div className='mb-8 flex items-center justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) =>
              dispatch({
                type: 'SET_ACTIVE_TAB',
                payload: value as 'home' | 'favorites',
              })
            }
          />
        </div>

        <div className='w-full mx-auto'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-0 sm:mb-8'>
              <div className='mb-6 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的收藏
                </h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 dark:text-red-400 dark:hover:text-white dark:hover:bg-red-500 border border-red-300 dark:border-red-700 hover:border-red-600 dark:hover:border-red-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
                    onClick={() => {
                      // 根据用户设置决定是否显示确认对话框
                      if (requireClearConfirmation) {
                        setShowClearFavoritesDialog(true);
                      } else {
                        handleClearFavorites();
                      }
                    }}
                  >
                    <Trash2 className='w-4 h-4' />
                    <span>清空收藏</span>
                  </button>
                )}
              </div>

              {/* 统计信息 */}
              {favoriteStats && (
                <div className='mb-4 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400'>
                  <span className='px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full'>
                    共{' '}
                    <strong className='text-gray-900 dark:text-gray-100'>
                      {favoriteStats.total}
                    </strong>{' '}
                    项
                  </span>
                  {favoriteStats.movie > 0 && (
                    <span className='px-3 py-1 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 rounded-full'>
                      电影 {favoriteStats.movie}
                    </span>
                  )}
                  {favoriteStats.tv > 0 && (
                    <span className='px-3 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-full'>
                      剧集 {favoriteStats.tv}
                    </span>
                  )}
                  {favoriteStats.anime > 0 && (
                    <span className='px-3 py-1 bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-300 rounded-full'>
                      动漫 {favoriteStats.anime}
                    </span>
                  )}
                  {favoriteStats.shortdrama > 0 && (
                    <span className='px-3 py-1 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 rounded-full'>
                      短剧 {favoriteStats.shortdrama}
                    </span>
                  )}
                  {favoriteStats.live > 0 && (
                    <span className='px-3 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-full'>
                      直播 {favoriteStats.live}
                    </span>
                  )}
                  {favoriteStats.variety > 0 && (
                    <span className='px-3 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-full'>
                      综艺 {favoriteStats.variety}
                    </span>
                  )}
                </div>
              )}

              {/* 筛选标签 */}
              {favoriteItems.length > 0 && (
                <div className='mb-4 flex flex-wrap gap-2'>
                  {[
                    { key: 'all' as const, label: '全部', icon: '📚' },
                    { key: 'movie' as const, label: '电影', icon: '🎬' },
                    { key: 'tv' as const, label: '剧集', icon: '📺' },
                    { key: 'anime' as const, label: '动漫', icon: '🎌' },
                    { key: 'shortdrama' as const, label: '短剧', icon: '🎭' },
                    { key: 'live' as const, label: '直播', icon: '📡' },
                    { key: 'variety' as const, label: '综艺', icon: '🎪' },
                  ].map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => setFavoriteFilter(key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                        favoriteFilter === key
                          ? 'bg-linear-to-r from-primary-500 to-purple-500 text-white shadow-lg scale-105'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className='mr-1'>{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* 排序选项 */}
              {favoriteItems.length > 0 && (
                <div className='mb-4 flex items-center gap-2 text-sm'>
                  <span className='text-gray-600 dark:text-gray-400'>
                    排序：
                  </span>
                  <div className='flex gap-2'>
                    {[
                      { key: 'recent' as const, label: '最近添加' },
                      { key: 'title' as const, label: '标题 A-Z' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setFavoriteSortBy(key)}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          favoriteSortBy === key
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-8'>
                {(() => {
                  // 筛选
                  let filtered = favoriteItems;
                  if (favoriteFilter === 'movie') {
                    filtered = favoriteItems.filter((item) => {
                      // 优先用 type 字段判断
                      if (item.type) return item.type === 'movie';
                      // 向后兼容：没有 type 时用 episodes 判断
                      if (
                        item.source === 'shortdrama' ||
                        item.source_name === '短剧'
                      )
                        return false;
                      if (item.source === 'bangumi') return false; // 排除动漫
                      if (item.origin === 'live') return false; // 排除直播
                      // vod 来源：按集数判断
                      return item.episodes === 1;
                    });
                  } else if (favoriteFilter === 'tv') {
                    filtered = favoriteItems.filter((item) => {
                      // 优先用 type 字段判断
                      if (item.type) return item.type === 'tv';
                      // 向后兼容：没有 type 时用 episodes 判断
                      if (
                        item.source === 'shortdrama' ||
                        item.source_name === '短剧'
                      )
                        return false;
                      if (item.source === 'bangumi') return false; // 排除动漫
                      if (item.origin === 'live') return false; // 排除直播
                      // vod 来源：按集数判断
                      return item.episodes > 1;
                    });
                  } else if (favoriteFilter === 'anime') {
                    filtered = favoriteItems.filter((item) => {
                      // 优先用 type 字段判断
                      if (item.type) return item.type === 'anime';
                      // 向后兼容：用 source 判断
                      return item.source === 'bangumi';
                    });
                  } else if (favoriteFilter === 'shortdrama') {
                    filtered = favoriteItems.filter((item) => {
                      // 优先用 type 字段判断
                      if (item.type) return item.type === 'shortdrama';
                      // 向后兼容：用 source 判断
                      return (
                        item.source === 'shortdrama' ||
                        item.source_name === '短剧'
                      );
                    });
                  } else if (favoriteFilter === 'live') {
                    filtered = favoriteItems.filter(
                      (item) => item.origin === 'live',
                    );
                  } else if (favoriteFilter === 'variety') {
                    filtered = favoriteItems.filter((item) => {
                      // 优先用 type 字段判断
                      if (item.type) return item.type === 'variety';
                      // 向后兼容：暂无 fallback
                      return false;
                    });
                  }

                  // 排序
                  if (favoriteSortBy === 'title') {
                    filtered = [...filtered].sort((a, b) =>
                      a.title.localeCompare(b.title, 'zh-CN'),
                    );
                  }
                  // 'recent' 已经在 updateFavoriteItems 中按 save_time 排序了

                  return filtered.map((item) => {
                    // 智能计算即将上映状态
                    let calculatedRemarks = item.remarks;

                    if (item.releaseDate) {
                      const releaseDate = new Date(item.releaseDate);
                      const daysDiff = Math.ceil(
                        (releaseDate.getTime() - today.getTime()) /
                          (1000 * 60 * 60 * 24),
                      );

                      // 根据天数差异动态更新显示文字
                      if (daysDiff < 0) {
                        const daysAgo = Math.abs(daysDiff);
                        calculatedRemarks = `已上映${daysAgo}天`;
                      } else if (daysDiff === 0) {
                        calculatedRemarks = '今日上映';
                      } else {
                        calculatedRemarks = `${daysDiff}天后上映`;
                      }
                    }

                    return (
                      <div key={item.id + item.source} className='w-full'>
                        <VideoCard
                          query={item.search_title}
                          {...item}
                          from='favorite'
                          remarks={calculatedRemarks}
                        />
                      </div>
                    );
                  });
                })()}
                {favoriteItems.length === 0 && (
                  <div className='col-span-full flex flex-col items-center justify-center py-16 px-4'>
                    {/* SVG 插画 - 空收藏夹 */}
                    <div className='mb-6 relative'>
                      <div className='absolute inset-0 bg-linear-to-r from-pink-300 to-purple-300 dark:from-pink-600 dark:to-purple-600 opacity-20 blur-3xl rounded-full animate-pulse'></div>
                      <svg
                        className='w-32 h-32 relative z-10'
                        viewBox='0 0 200 200'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        {/* 心形主体 */}
                        <path
                          d='M100 170C100 170 30 130 30 80C30 50 50 30 70 30C85 30 95 40 100 50C105 40 115 30 130 30C150 30 170 50 170 80C170 130 100 170 100 170Z'
                          className='fill-gray-300 dark:fill-gray-600 stroke-gray-400 dark:stroke-gray-500 transition-colors duration-300'
                          strokeWidth='3'
                        />
                        {/* 虚线边框 */}
                        <path
                          d='M100 170C100 170 30 130 30 80C30 50 50 30 70 30C85 30 95 40 100 50C105 40 115 30 130 30C150 30 170 50 170 80C170 130 100 170 100 170Z'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeDasharray='5,5'
                          className='text-gray-400 dark:text-gray-500'
                        />
                      </svg>
                    </div>

                    {/* 文字提示 */}
                    <h3 className='text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2'>
                      收藏夹空空如也
                    </h3>
                    <p className='text-sm text-gray-500 dark:text-gray-400 text-center max-w-xs'>
                      快去发现喜欢的影视作品，点击 ❤️ 添加到收藏吧！
                    </p>
                  </div>
                )}
              </div>

              {/* 确认对话框 */}
              <ConfirmDialog
                isOpen={showClearFavoritesDialog}
                title='确认清空收藏'
                message={`确定要清空所有收藏吗？\n\n这将删除 ${favoriteItems.length} 项收藏，此操作无法撤销。`}
                confirmText='确认清空'
                cancelText='取消'
                variant='danger'
                onConfirm={handleClearFavorites}
                onCancel={() => setShowClearFavoritesDialog(false)}
              />
            </section>
          ) : (
            // 首页视图
            <>
              {/* Hero Banner 轮播 */}
              {(heroItems.length > 0 ||
                loading.movies ||
                loading.tv ||
                loading.variety ||
                loading.anime) && (
                <section className='mb-10 sm:mb-8'>
                  {heroItems.length > 0 ? (
                    <MemoizedHeroBanner
                      items={heroItems}
                      candidates={heroCandidates}
                      autoPlayInterval={8000}
                      showControls={true}
                      showIndicators={true}
                      enableVideo={true}
                    />
                  ) : (
                    <div
                      aria-hidden='true'
                      className='h-[50vh] w-full rounded-xl bg-gray-100/70 dark:bg-gray-900/40 sm:h-[55vh] md:h-[60vh]'
                      data-hero-placeholder='true'
                    />
                  )}
                </section>
              )}

              {/* 继续观看 */}
              <ContinueWatching />

              <HomeRecommendationSections
                errors={recommendationErrors}
                hotMovies={hotMovies}
                hotShortDramas={hotShortDramas}
                hotTvShows={hotTvShows}
                hotVarietyShows={hotVarietyShows}
                loading={loading}
                onUpcomingFilterChange={handleUpcomingFilterChange}
                retry={retryRecommendation}
                today={today}
                todayAnimes={todayAnimes}
                upcomingFilter={upcomingFilter}
                upcomingReleases={upcomingReleases}
              />
            </>
          )}
        </div>
      </div>
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-9999 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
          onTouchStart={(e) => {
            // 如果点击的是背景区域，阻止触摸事件冒泡，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          onTouchMove={(e) => {
            // 如果触摸的是背景区域，阻止触摸移动，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchEnd={(e) => {
            // 如果触摸的是背景区域，阻止触摸结束事件，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          style={{
            touchAction: 'none', // 禁用所有触摸操作
          }}
        >
          <div
            className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'
            onTouchMove={(e) => {
              // 允许公告内容区域正常滚动，阻止事件冒泡到外层
              e.stopPropagation();
            }}
            style={{
              touchAction: 'auto', // 允许内容区域的正常触摸操作
            }}
          >
            <div className='mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-primary-500 pb-1'>
                提示
              </h3>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-primary-50 dark:bg-primary-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-primary-500 dark:bg-primary-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-linear-to-r from-primary-600 to-primary-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-primary-700 hover:to-primary-800 dark:from-primary-600 dark:to-primary-700 dark:hover:from-primary-700 dark:hover:to-primary-800 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
