/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  memo,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { BangumiCalendarData, GetBangumiCalendarData } from '@/lib/bangumi-api';
// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories, getDoubanDetails } from '@/lib/douban-api';
import { getRecommendedShortDramas } from '@/lib/shortdrama-api';
import {
  Favorite,
  PlayRecord,
  ReleaseCalendarItem,
  ShortDramaItem,
} from '@/lib/types';
import { DoubanMovieDetail } from '@/lib/types';

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
  hotMovies: DoubanMovieDetail[];
  hotTvShows: DoubanMovieDetail[];
  hotVarietyShows: DoubanMovieDetail[];
  hotAnime: DoubanMovieDetail[];
  hotShortDramas: ShortDramaItem[];
  bangumiCalendarData: BangumiCalendarData[];
  upcomingReleases: ReleaseCalendarItem[];
  loading: {
    movies: boolean;
    tv: boolean;
    variety: boolean;
    anime: boolean;
    shortDramas: boolean;
    bangumi: boolean;
    upcoming: boolean;
  };
  shortDramasError: boolean;
  username: string;
  showAnnouncement: boolean;
}

type HomeAction =
  | { type: 'SET_ACTIVE_TAB'; payload: 'home' | 'favorites' }
  | { type: 'SET_HOT_MOVIES'; payload: DoubanMovieDetail[] }
  | { type: 'SET_HOT_TV_SHOWS'; payload: DoubanMovieDetail[] }
  | { type: 'SET_HOT_VARIETY_SHOWS'; payload: DoubanMovieDetail[] }
  | { type: 'SET_HOT_ANIME'; payload: DoubanMovieDetail[] }
  | { type: 'SET_HOT_SHORT_DRAMAS'; payload: ShortDramaItem[] }
  | { type: 'SET_BANGUMI_CALENDAR_DATA'; payload: BangumiCalendarData[] }
  | { type: 'SET_UPCOMING_RELEASES'; payload: ReleaseCalendarItem[] }
  | { type: 'SET_LOADING'; payload: Partial<HomeState['loading']> }
  | { type: 'SET_SHORT_DRAMAS_ERROR'; payload: boolean }
  | { type: 'SET_USERNAME'; payload: string }
  | { type: 'SET_SHOW_ANNOUNCEMENT'; payload: boolean }
  | {
      type: 'UPDATE_HOT_MOVIES';
      payload: (prev: DoubanMovieDetail[]) => DoubanMovieDetail[];
    }
  | {
      type: 'UPDATE_HOT_TV_SHOWS';
      payload: (prev: DoubanMovieDetail[]) => DoubanMovieDetail[];
    }
  | {
      type: 'UPDATE_HOT_VARIETY_SHOWS';
      payload: (prev: DoubanMovieDetail[]) => DoubanMovieDetail[];
    }
  | {
      type: 'UPDATE_HOT_ANIME';
      payload: (prev: DoubanMovieDetail[]) => DoubanMovieDetail[];
    }
  | {
      type: 'UPDATE_HOT_SHORT_DRAMAS';
      payload: (prev: ShortDramaItem[]) => ShortDramaItem[];
    };

const homeReducer = (state: HomeState, action: HomeAction): HomeState => {
  switch (action.type) {
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    case 'SET_HOT_MOVIES':
      return { ...state, hotMovies: action.payload };
    case 'SET_HOT_TV_SHOWS':
      return { ...state, hotTvShows: action.payload };
    case 'SET_HOT_VARIETY_SHOWS':
      return { ...state, hotVarietyShows: action.payload };
    case 'SET_HOT_ANIME':
      return { ...state, hotAnime: action.payload };
    case 'SET_HOT_SHORT_DRAMAS':
      return { ...state, hotShortDramas: action.payload };
    case 'SET_BANGUMI_CALENDAR_DATA':
      return { ...state, bangumiCalendarData: action.payload };
    case 'SET_UPCOMING_RELEASES':
      return { ...state, upcomingReleases: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: { ...state.loading, ...action.payload } };
    case 'SET_SHORT_DRAMAS_ERROR':
      return { ...state, shortDramasError: action.payload };
    case 'SET_USERNAME':
      return { ...state, username: action.payload };
    case 'SET_SHOW_ANNOUNCEMENT':
      return { ...state, showAnnouncement: action.payload };
    case 'UPDATE_HOT_MOVIES':
      return { ...state, hotMovies: action.payload(state.hotMovies) };
    case 'UPDATE_HOT_TV_SHOWS':
      return { ...state, hotTvShows: action.payload(state.hotTvShows) };
    case 'UPDATE_HOT_VARIETY_SHOWS':
      return {
        ...state,
        hotVarietyShows: action.payload(state.hotVarietyShows),
      };
    case 'UPDATE_HOT_ANIME':
      return { ...state, hotAnime: action.payload(state.hotAnime) };
    case 'UPDATE_HOT_SHORT_DRAMAS':
      return { ...state, hotShortDramas: action.payload(state.hotShortDramas) };
    default:
      return state;
  }
};

function HomeClient() {
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);
  // 🚀 TanStack Query - 全局缓存管理
  const queryClient = useQueryClient();
  const { announcement } = useSite();
  const [isMounted, setIsMounted] = useState(false);
  // 使用 reducer 集中管理首页状态，非交互型数据更新统一降为 transition。
  const [state, dispatch] = useReducer(homeReducer, {
    activeTab: 'home',
    hotMovies: [],
    hotTvShows: [],
    hotVarietyShows: [],
    hotAnime: [],
    hotShortDramas: [],
    bangumiCalendarData: [],
    upcomingReleases: [],
    loading: {
      movies: true,
      tv: true,
      variety: true,
      anime: true,
      shortDramas: true,
      bangumi: true,
      upcoming: true,
    },
    shortDramasError: false,
    username: '',
    showAnnouncement: false,
  });

  const dispatchDeferred = useCallback((action: HomeAction) => {
    startTransition(() => dispatch(action));
  }, []);

  // 解构状态以便使用
  const {
    activeTab,
    hotMovies,
    hotTvShows,
    hotVarietyShows,
    hotAnime,
    hotShortDramas,
    bangumiCalendarData,
    upcomingReleases,
    loading,
    shortDramasError,
    username,
    showAnnouncement,
  } = state;

  // 🚀 Web Worker引用
  const workerRef = useRef<Worker | null>(null);

  // 🎯 优化：缓存今日番剧计算
  const todayAnimes = useMemo(() => {
    const today = new Date();
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekday = weekdays[today.getDay()];

    return (
      bangumiCalendarData.find((item) => item.weekday.en === currentWeekday)
        ?.items || []
    );
  }, [bangumiCalendarData]); // 依赖bangumiCalendarData，数据变化时重新计算

  // 🎯 优化：缓存今天的日期（用于上映日期计算）
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []); // 空依赖，只在组件挂载时计算一次

  const heroItems = useMemo(
    () => [
      ...hotMovies.slice(0, 2).map((movie) => ({
        id: movie.id,
        title: movie.title,
        poster: movie.poster,
        backdrop: movie.backdrop,
        trailerUrl: movie.trailerUrl,
        description: movie.plot_summary,
        year: movie.year,
        rate: movie.rate,
        douban_id: Number(movie.id),
        type: 'movie',
      })),
      ...hotTvShows.slice(0, 2).map((show) => ({
        id: show.id,
        title: show.title,
        poster: show.poster,
        backdrop: show.backdrop,
        trailerUrl: show.trailerUrl,
        description: show.plot_summary,
        year: show.year,
        rate: show.rate,
        douban_id: Number(show.id),
        type: 'tv',
      })),
      ...hotVarietyShows.slice(0, 1).map((show) => ({
        id: show.id,
        title: show.title,
        poster: show.poster,
        backdrop: show.backdrop,
        trailerUrl: show.trailerUrl,
        description: show.plot_summary,
        year: show.year,
        rate: show.rate,
        douban_id: Number(show.id),
        type: 'variety',
      })),
      ...hotAnime.slice(0, 1).map((anime) => ({
        id: anime.id,
        title: anime.title,
        poster: anime.poster,
        backdrop: anime.backdrop,
        trailerUrl: anime.trailerUrl,
        description: anime.plot_summary,
        year: anime.year,
        rate: anime.rate,
        douban_id: Number(anime.id),
        type: 'anime',
      })),
    ],
    [hotAnime, hotMovies, hotTvShows, hotVarietyShows],
  );

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

  // 🚀 TanStack Query - 使用 useQuery 获取收藏数据（自动缓存，跨页面持久化）
  const { data: allFavorites = {} } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => getAllFavorites(),
    staleTime: 5 * 60 * 1000, // 5分钟内数据保持新鲜
    gcTime: 10 * 60 * 1000, // 10分钟后垃圾回收
  });

  // 🚀 TanStack Query - 使用 useQuery 获取播放记录（自动缓存，跨页面持久化）
  const { data: allPlayRecords = {} } = useQuery({
    queryKey: ['playRecords'],
    queryFn: () => getAllPlayRecords(),
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

  useEffect(() => {
    const fetchRecommendData = async () => {
      dispatchDeferred({
        type: 'SET_LOADING',
        payload: {
          movies: true,
          tv: true,
          variety: true,
          anime: true,
          shortDramas: true,
          bangumi: true,
          upcoming: true,
        },
      });

      const moviesPromise = getDoubanCategories({
        kind: 'movie',
        category: '热门',
        type: '全部',
      })
        .then((moviesData) => {
          if (moviesData?.code !== 200) return;
          const movies = moviesData.list;
          dispatchDeferred({ type: 'SET_HOT_MOVIES', payload: movies });

          // 延迟加载详情，避免阻塞主线程
          setTimeout(() => {
            Promise.all(
              movies.slice(0, 2).map(async (movie) => {
                try {
                  const detailsRes = await getDoubanDetails(movie.id);
                  if (
                    detailsRes.code === 200 &&
                    detailsRes.list &&
                    detailsRes.list[0]
                  ) {
                    return {
                      id: movie.id,
                      plot_summary: detailsRes.list[0].plot_summary,
                      backdrop: detailsRes.list[0].backdrop,
                      trailerUrl: detailsRes.list[0].trailerUrl,
                    };
                  }
                } catch (error) {
                  console.warn(`获取电影 ${movie.id} 详情失败:`, error);
                }
                return null;
              }),
            ).then((results) => {
              dispatchDeferred({
                type: 'UPDATE_HOT_MOVIES',
                payload: (prev) =>
                  prev.map((m) => {
                    const detail = results.find((r) => r?.id === m.id);
                    return detail ? { ...m, ...detail } : m;
                  }),
              });
            });
          }, 2000);
        })
        .catch((error) => {
          console.warn('获取热门电影失败:', error);
        })
        .finally(() =>
          dispatchDeferred({ type: 'SET_LOADING', payload: { movies: false } }),
        );

      const tvShowsPromise = getDoubanCategories({
        kind: 'tv',
        category: 'tv',
        type: 'tv',
      })
        .then((tvShowsData) => {
          if (tvShowsData?.code !== 200) return;
          const tvShows = tvShowsData.list;
          dispatchDeferred({ type: 'SET_HOT_TV_SHOWS', payload: tvShows });

          // 延迟加载详情
          setTimeout(() => {
            Promise.all(
              tvShows.slice(0, 2).map(async (show) => {
                try {
                  const detailsRes = await getDoubanDetails(show.id);
                  if (
                    detailsRes.code === 200 &&
                    detailsRes.list &&
                    detailsRes.list[0]
                  ) {
                    return {
                      id: show.id,
                      plot_summary: detailsRes.list[0].plot_summary,
                      backdrop: detailsRes.list[0].backdrop,
                      trailerUrl: detailsRes.list[0].trailerUrl,
                    };
                  }
                } catch (error) {
                  console.warn(`获取剧集 ${show.id} 详情失败:`, error);
                }
                return null;
              }),
            ).then((results) => {
              dispatchDeferred({
                type: 'UPDATE_HOT_TV_SHOWS',
                payload: (prev) =>
                  prev.map((s) => {
                    const detail = results.find((r) => r?.id === s.id);
                    return detail ? { ...s, ...detail } : s;
                  }),
              });
            });
          }, 2000);
        })
        .catch((error) => {
          console.warn('获取热门剧集失败:', error);
        })
        .finally(() =>
          dispatchDeferred({ type: 'SET_LOADING', payload: { tv: false } }),
        );

      const varietyShowsPromise = getDoubanCategories({
        kind: 'tv',
        category: 'show',
        type: 'show',
      })
        .then((varietyShowsData) => {
          if (varietyShowsData?.code !== 200) return;
          const varietyShows = varietyShowsData.list;
          dispatchDeferred({
            type: 'SET_HOT_VARIETY_SHOWS',
            payload: varietyShows,
          });

          // 延迟加载详情
          if (varietyShows.length > 0) {
            setTimeout(() => {
              const show = varietyShows[0];
              getDoubanDetails(show.id)
                .then((detailsRes) => {
                  if (
                    detailsRes.code === 200 &&
                    detailsRes.list &&
                    detailsRes.list[0]
                  ) {
                    dispatchDeferred({
                      type: 'UPDATE_HOT_VARIETY_SHOWS',
                      payload: (prev) =>
                        prev.map((s) =>
                          s.id === show.id
                            ? { ...s, ...detailsRes.list[0] }
                            : s,
                        ),
                    });
                  }
                })
                .catch((error) => {
                  console.warn(`获取综艺 ${show.id} 详情失败:`, error);
                });
            }, 3000);
          }
        })
        .catch((error) => {
          console.warn('获取热门综艺失败:', error);
        })
        .finally(() =>
          dispatchDeferred({
            type: 'SET_LOADING',
            payload: { variety: false },
          }),
        );

      const animePromise = getDoubanCategories({
        kind: 'tv',
        category: 'tv',
        type: 'tv_animation',
      })
        .then((animeData) => {
          if (animeData?.code !== 200) return;
          const animes = animeData.list;
          dispatchDeferred({ type: 'SET_HOT_ANIME', payload: animes });

          // 延迟加载详情
          if (animes.length > 0) {
            setTimeout(() => {
              const anime = animes[0];
              getDoubanDetails(anime.id)
                .then((detailsRes) => {
                  if (
                    detailsRes.code === 200 &&
                    detailsRes.list &&
                    detailsRes.list[0]
                  ) {
                    dispatchDeferred({
                      type: 'UPDATE_HOT_ANIME',
                      payload: (prev) =>
                        prev.map((a) =>
                          a.id === anime.id
                            ? { ...a, ...detailsRes.list[0] }
                            : a,
                        ),
                    });
                  }
                })
                .catch((error) => {
                  console.warn(`获取动漫 ${anime.id} 详情失败:`, error);
                });
            }, 3000);
          }
        })
        .catch((error) => {
          console.warn('获取热门动漫失败:', error);
        })
        .finally(() =>
          dispatchDeferred({ type: 'SET_LOADING', payload: { anime: false } }),
        );

      const shortDramasPromise = getRecommendedShortDramas(15)
        .then((dramas) => {
          dispatchDeferred({
            type: 'SET_SHORT_DRAMAS_ERROR',
            payload: dramas.length === 0,
          });
          dispatchDeferred({ type: 'SET_HOT_SHORT_DRAMAS', payload: dramas });

          // 延迟加载详情
          // setTimeout(() => {
          //   Promise.all(
          //     dramas.slice(0, 2).map(async (drama) => {
          //       try {
          //         const detailData: SearchResult = await getShortDramaDetail({
          //           id: drama.id.toString(),
          //           videoId: drama.id,
          //           episode: 1,
          //         });
          //         if (detailData.desc) {
          //           return { id: drama.id, description: detailData.desc };
          //         }
          //       } catch (error) {
          //         console.warn(`获取短剧 ${drama.id} 详情失败:`, error);
          //       }
          //       return null;
          //     }),
          //   ).then((results) => {
          //     dispatch({
          //       type: 'UPDATE_HOT_SHORT_DRAMAS',
          //       payload: (prev) =>
          //         prev.map((d) => {
          //           const detail = results.find((r) => r?.id === d.id);
          //           return detail
          //             ? { ...d, description: detail.description }
          //             : d;
          //         }),
          //     });
          //   });
          // }, 3000);
        })
        .catch((error) => {
          console.warn('获取热门短剧失败:', error);
          dispatchDeferred({
            type: 'SET_SHORT_DRAMAS_ERROR',
            payload: true,
          });
        })
        .finally(() =>
          dispatchDeferred({
            type: 'SET_LOADING',
            payload: { shortDramas: false },
          }),
        );

      const bangumiPromise = GetBangumiCalendarData()
        .then((bangumiData) => {
          if (!Array.isArray(bangumiData)) return;
          dispatchDeferred({
            type: 'SET_BANGUMI_CALENDAR_DATA',
            payload: bangumiData,
          });
        })
        .catch((error) => {
          console.warn('获取 Bangumi 日历失败:', error);
        })
        .finally(() =>
          dispatchDeferred({
            type: 'SET_LOADING',
            payload: { bangumi: false },
          }),
        );

      const upcomingPromise = fetch('/api/release-calendar?limit=100')
        .then((res) => {
          if (!res.ok) {
            console.error('获取即将上映数据失败，状态码:', res.status);
            return { items: [] };
          }
          return res.json();
        })
        .then((upcomingData) => {
          if (!upcomingData?.items) {
            console.warn('获取即将上映数据失败: 数据格式错误');
            dispatchDeferred({ type: 'SET_UPCOMING_RELEASES', payload: [] });
            return;
          }

          const releases = upcomingData.items;
          console.log('🎬 获取到的即将上映数据:', releases.length, '条');

          // 初始化 Web Worker
          if (
            !workerRef.current &&
            typeof window !== 'undefined' &&
            window.Worker
          ) {
            try {
              workerRef.current = new Worker(
                new URL('../lib/release-calendar-worker.ts', import.meta.url),
              );

              workerRef.current.onmessage = (e: MessageEvent) => {
                const { selectedItems, stats, error } = e.data;

                if (error) {
                  console.error('🎬 [Worker] 处理失败:', error);
                  dispatchDeferred({
                    type: 'SET_UPCOMING_RELEASES',
                    payload: [],
                  });
                  return;
                }

                console.log('🎬 [Main] Worker处理完成，分配结果:', stats);
                dispatchDeferred({
                  type: 'SET_UPCOMING_RELEASES',
                  payload: selectedItems,
                });
              };

              workerRef.current.onerror = (error) => {
                console.error('🎬 [Worker] 错误:', error);
                dispatchDeferred({
                  type: 'SET_UPCOMING_RELEASES',
                  payload: [],
                });
              };
            } catch (error) {
              console.error('🎬 [Worker] 初始化失败:', error);
              dispatchDeferred({
                type: 'SET_UPCOMING_RELEASES',
                payload: [],
              });
            }
          }

          // 发送数据到 Worker 处理
          if (workerRef.current) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            workerRef.current.postMessage({
              releases,
              today: today.toISOString().split('T')[0],
            });
          } else {
            // Fallback: Worker 不可用时的处理
            console.warn('🎬 Web Worker不可用，跳过即将上映数据处理');
            dispatchDeferred({ type: 'SET_UPCOMING_RELEASES', payload: [] });
          }
        })
        .catch((error) => {
          console.warn('获取即将上映数据失败:', error);
          dispatchDeferred({ type: 'SET_UPCOMING_RELEASES', payload: [] });
        })
        .finally(() =>
          dispatchDeferred({
            type: 'SET_LOADING',
            payload: { upcoming: false },
          }),
        );

      await Promise.allSettled([
        moviesPromise,
        tvShowsPromise,
        varietyShowsPromise,
        animePromise,
        shortDramasPromise,
        bangumiPromise,
        upcomingPromise,
      ]);
    };
    fetchRecommendData();

    // 🚀 清理Web Worker
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
        console.log('📅 [Main] Web Worker已清理');
      }
    };
  }, []);

  // 🚀 TanStack Query - 处理清空所有收藏（使用 queryClient 刷新缓存）
  const handleClearFavorites = async () => {
    await clearAllFavorites();
    // 刷新收藏数据缓存
    queryClient.invalidateQueries({ queryKey: ['favorites'] });
  };

  // 🚀 TanStack Query - 监听数据更新事件，自动刷新缓存
  useEffect(() => {
    // 监听收藏更新事件
    const unsubscribeFavorites = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, Favorite>) => {
        // 直接使用事件数据更新缓存，避免立即请求拿到旧数据
        queryClient.setQueryData(['favorites'], newFavorites);
      },
    );

    // 监听播放记录更新事件
    const unsubscribePlayRecords = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        // 直接使用事件数据更新缓存，避免立即请求拿到旧数据
        queryClient.setQueryData(['playRecords'], newRecords);
      },
    );

    return () => {
      unsubscribeFavorites();
      unsubscribePlayRecords();
    };
  }, [queryClient]); // 依赖 queryClient

  const handleCloseAnnouncement = (announcement: string) => {
    dispatch({ type: 'SET_SHOW_ANNOUNCEMENT', payload: false });
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  if (!isMounted) {
    return (
      <PageLayout>
        <div className='flex items-center justify-center min-h-[50vh]'>
          <div className='flex flex-col items-center gap-4'>
            <div className='w-12 h-12 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin' />
            <p className='text-gray-500 dark:text-gray-400 animate-pulse'>
              正在进入首页...
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }

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
                hotMovies={hotMovies}
                hotShortDramas={hotShortDramas}
                hotTvShows={hotTvShows}
                hotVarietyShows={hotVarietyShows}
                loading={loading}
                onUpcomingFilterChange={handleUpcomingFilterChange}
                shortDramasError={shortDramasError}
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

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
