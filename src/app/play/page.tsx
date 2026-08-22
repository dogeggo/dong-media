'use client';

import Hls from 'hls.js';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  type AdFilterConfig,
  DEFAULT_AD_FILTER_CONFIG,
  filterM3u8Ads,
} from '@/lib/ad-filter';
import artplayerPluginChromecast from '@/lib/artplayer-plugin-chromecast';
import artplayerPluginLiquidGlass from '@/lib/artplayer-plugin-liquid-glass';
import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  getAllFavorites,
  getAllPlayRecords,
  getCachedPlayRecords,
  saveFavorite,
  savePlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanComments, getDoubanDetails } from '@/lib/douban-api';
import { createLatestTaskQueue } from '@/lib/latest-task-queue';
import { matchesRequestedYear } from '@/lib/play-source-matching';
import { PlayRecord, SearchResult } from '@/lib/types';
import { generateSearchVariants } from '@/lib/utils';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

import DownloadEpisodeSelector from '@/components/download/DownloadEpisodeSelector';
import PageLayout from '@/components/PageLayout';
import BackToTopButton from '@/components/play/BackToTopButton';
import LoadingScreen from '@/components/play/LoadingScreen';
import PlayDetailsSection from '@/components/play/PlayDetailsSection';
import PlayErrorState from '@/components/play/PlayErrorState';
import PlayHeader from '@/components/play/PlayHeader';
import PlayNetdiskModal from '@/components/play/PlayNetdiskModal';
import PlayPlayerPanel from '@/components/play/PlayPlayerPanel';
import PlayToolbar from '@/components/play/PlayToolbar';

import { useDownload } from '@/contexts/DownloadContext';
import { useNavigationLoading } from '@/contexts/NavigationLoadingContext';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API 类型声明
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

const PLAY_PROGRESS_SAVE_INTERVAL_MS = 120 * 1000;
const PLAY_PROGRESS_MIN_DELTA_SECONDS = 15;

interface PlayProgressIdentity {
  key: string;
  episode: number;
  playTime: number;
  totalTime: number;
  totalEpisodes: number;
}

interface PendingPlayProgress {
  source: string;
  id: string;
  record: PlayRecord;
  identity: PlayProgressIdentity;
}

function isSamePlayProgress(
  left: PlayProgressIdentity | null,
  right: PlayProgressIdentity,
): boolean {
  return Boolean(
    left &&
    left.key === right.key &&
    left.episode === right.episode &&
    left.playTime === right.playTime &&
    left.totalTime === right.totalTime &&
    left.totalEpisodes === right.totalEpisodes,
  );
}

function shouldQueuePlayProgress(
  previous: PlayProgressIdentity | null,
  next: PlayProgressIdentity,
): boolean {
  if (!previous) return true;
  if (
    previous.key !== next.key ||
    previous.episode !== next.episode ||
    previous.totalEpisodes !== next.totalEpisodes ||
    Math.abs(previous.totalTime - next.totalTime) > 1
  ) {
    return true;
  }
  return (
    Math.abs(previous.playTime - next.playTime) >=
    PLAY_PROGRESS_MIN_DELTA_SECONDS
  );
}

function PlayPageClient() {
  const searchParams = useSearchParams();
  const { createTask, setShowDownloadPanel } = useDownload();
  const { stopNavigation } = useNavigationLoading();

  // 播放页挂载后关闭导航加载提示
  useEffect(() => {
    stopNavigation();
  }, [stopNavigation]);

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 豆瓣详情状态
  const [movieDetails, setMovieDetails] = useState<any>(null);
  const [loadingMovieDetails, setLoadingMovieDetails] = useState(false);
  const [lastMovieDetailsFetchTime, setLastMovieDetailsFetchTime] =
    useState<number>(0); // 记录上次请求时间

  // 豆瓣短评状态
  const [movieComments, setMovieComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  // bangumi详情状态
  const [bangumiDetails, setBangumiDetails] = useState<any>(null);
  const [loadingBangumiDetails, setLoadingBangumiDetails] = useState(false);

  const loadedCommentsIdRef = useRef<string | number | null>(null);

  // 网盘搜索状态
  const [netdiskResults, setNetdiskResults] = useState<{
    [key: string]: any[];
  } | null>(null);
  const [netdiskLoading, setNetdiskLoading] = useState(false);
  const [netdiskError, setNetdiskError] = useState<string | null>(null);
  const [netdiskTotal, setNetdiskTotal] = useState(0);
  const [showNetdiskModal, setShowNetdiskModal] = useState(false);
  const [netdiskResourceType, setNetdiskResourceType] = useState<
    'netdisk' | 'acg'
  >('netdisk'); // 资源类型

  // ACG 动漫磁力搜索状态
  const [acgTriggerSearch, setAcgTriggerSearch] = useState<boolean>();

  // 演员作品状态
  const [selectedCelebrityName, setSelectedCelebrityName] = useState<
    string | null
  >(null);
  const [celebrityWorks, setCelebrityWorks] = useState<any[]>([]);
  const [loadingCelebrityWorks, setLoadingCelebrityWorks] = useState(false);

  // SkipController 相关状态
  const [isSkipSettingOpen, setIsSkipSettingOpen] = useState(false);
  const [currentPlayTime, setCurrentPlayTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // 下载选集面板状态
  const [showDownloadEpisodeSelector, setShowDownloadEpisodeSelector] =
    useState(false);

  // 下载功能启用状态
  const [downloadEnabled, setDownloadEnabled] = useState(true);

  // 视频分辨率状态
  // 进度条拖拽状态管理
  const isDraggingProgressRef = useRef(false);
  const seekResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // resize事件防抖管理
  const resizeResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);

  // 结构化去广告规则
  const [adFilterConfig, setAdFilterConfig] = useState<AdFilterConfig>({
    ...DEFAULT_AD_FILTER_CONFIG,
  });
  const adFilterConfigRef = useRef(adFilterConfig);

  // 外部弹幕开关（从 localStorage 继承，默认全部关闭）
  const [externalDanmuEnabled, setExternalDanmuEnabled] = useState<boolean>(
    () => {
      if (typeof window !== 'undefined') {
        const v = localStorage.getItem('enable_external_danmu');
        if (v !== null) return v === 'true';
      }
      return false; // 默认关闭外部弹幕
    },
  );
  const externalDanmuEnabledRef = useRef(externalDanmuEnabled);

  // Anime4K超分相关状态
  const [webGPUSupported, setWebGPUSupported] = useState<boolean>(false);
  const [anime4kEnabled, setAnime4kEnabled] = useState<boolean>(false);
  const [anime4kMode, setAnime4kMode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('anime4k_mode');
      if (v !== null) return v;
    }
    return 'ModeA';
  });
  const [anime4kScale, setAnime4kScale] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('anime4k_scale');
      if (v !== null) return parseFloat(v);
    }
    return 2.0;
  });
  const anime4kRef = useRef<any>(null);
  const anime4kEnabledRef = useRef(anime4kEnabled);
  const anime4kModeRef = useRef(anime4kMode);
  const anime4kScaleRef = useRef(anime4kScale);

  const ANIME4K_DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
  const ANIME4K_BYTES_PER_PIXEL = 4;
  const ANIME4K_BUFFER_FACTOR = 16;
  const isWindowsPlatform =
    typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

  const getAnime4KModeLabel = (mode: string) => {
    switch (mode) {
      case 'ModeA':
        return 'ModeA (快速)';
      case 'ModeB':
        return 'ModeB (标准)';
      case 'ModeC':
        return 'ModeC (高质)';
      case 'ModeAA':
        return 'ModeAA (极速)';
      case 'ModeBB':
        return 'ModeBB (平衡)';
      case 'ModeCA':
        return 'ModeCA (优质)';
      default:
        return mode || 'ModeA (快速)';
    }
  };

  const getAnime4KScaleLabel = (scale: number) => {
    if (!Number.isFinite(scale)) return '2.0x';
    return `${scale.toFixed(1)}x`;
  };

  const estimateAnime4KBufferBytes = (
    width: number,
    height: number,
    scale: number,
  ) => {
    const outputWidth = Math.floor(width * scale);
    const outputHeight = Math.floor(height * scale);
    if (!outputWidth || !outputHeight) return Number.POSITIVE_INFINITY;
    return (
      outputWidth *
      outputHeight *
      ANIME4K_BYTES_PER_PIXEL *
      ANIME4K_BUFFER_FACTOR
    );
  };

  const ensureRequestVideoFrameCallback = (
    element: HTMLVideoElement | HTMLCanvasElement,
  ) => {
    const anyElement = element as any;
    if (anyElement.__anime4kRvfcWrapped) return;

    anyElement.__anime4kRvfcWrapped = true;
    anyElement.__anime4kOriginalRequestVideoFrameCallback =
      anyElement.requestVideoFrameCallback;
    anyElement.__anime4kOriginalCancelVideoFrameCallback =
      anyElement.cancelVideoFrameCallback;

    const scheduleWithRaf = (cb: any) => {
      const handle = requestAnimationFrame((now) => {
        if (anyElement.__anime4kFrameCallbackEnabled === false) {
          return;
        }
        const width = anyElement.videoWidth ?? anyElement.width ?? 0;
        const height = anyElement.videoHeight ?? anyElement.height ?? 0;
        const metadata = {
          mediaTime: anyElement.currentTime ?? now / 1000,
          presentedFrames: 0,
          expectedDisplayTime: now,
          width,
          height,
        };
        cb(now, metadata);
      });
      return handle;
    };

    anyElement.requestVideoFrameCallback = (cb: any) => {
      if (anyElement.__anime4kFrameCallbackEnabled === false) {
        return 0;
      }

      const original = anyElement.__anime4kOriginalRequestVideoFrameCallback;
      const handle =
        typeof original === 'function'
          ? original.call(anyElement, (now: number, metadata: any) => {
              if (anyElement.__anime4kFrameCallbackEnabled === false) {
                return;
              }
              cb(now, metadata);
            })
          : scheduleWithRaf(cb);
      anyElement.__anime4kFrameCallbackHandle = handle;
      return handle;
    };

    anyElement.cancelVideoFrameCallback = (handle: number) => {
      const originalCancel =
        anyElement.__anime4kOriginalCancelVideoFrameCallback;
      if (typeof originalCancel === 'function') {
        originalCancel.call(anyElement, handle);
      } else {
        cancelAnimationFrame(handle);
      }
      if (anyElement.__anime4kFrameCallbackHandle === handle) {
        anyElement.__anime4kFrameCallbackHandle = null;
      }
    };
  };

  const ensureAnime4KMaxBufferLimit = async (requiredBytes: number) => {
    if (requiredBytes <= ANIME4K_DEFAULT_MAX_BUFFER_BYTES) return true;
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      return false;
    }

    try {
      const adapter = await (navigator as any).gpu.requestAdapter(
        isWindowsPlatform ? undefined : { powerPreference: 'high-performance' },
      );
      if (!adapter) return false;

      const maxSupported = adapter.limits?.maxBufferSize ?? 0;
      if (!maxSupported || maxSupported < requiredBytes) return false;

      const requiredLimit = Math.min(maxSupported, requiredBytes);
      const win = window as any;
      win.__anime4kRequiredMaxBufferBytes = Math.max(
        win.__anime4kRequiredMaxBufferBytes ?? 0,
        requiredLimit,
      );

      const gpu = navigator.gpu as any;
      if (!gpu.__anime4kPatched) {
        const originalRequestAdapter = navigator.gpu.requestAdapter.bind(
          navigator.gpu,
        );
        gpu.__anime4kPatched = true;
        gpu.__anime4kOriginalRequestAdapter = originalRequestAdapter;

        gpu.requestAdapter = async (options?: any) => {
          const patchedAdapter = await originalRequestAdapter(options);
          if (!patchedAdapter) return patchedAdapter;

          const originalRequestDevice =
            patchedAdapter.requestDevice.bind(patchedAdapter);

          patchedAdapter.requestDevice = async (descriptor?: any) => {
            const currentRequired = (window as any)
              .__anime4kRequiredMaxBufferBytes;
            if (!currentRequired) return originalRequestDevice(descriptor);

            const supportedLimit =
              patchedAdapter.limits?.maxBufferSize ?? currentRequired;
            const existingLimit =
              descriptor?.requiredLimits?.maxBufferSize ?? 0;
            const targetLimit = Math.min(
              supportedLimit,
              Math.max(existingLimit, currentRequired),
            );

            const requiredLimits = {
              ...(descriptor?.requiredLimits ?? {}),
              maxBufferSize: targetLimit,
            };

            return originalRequestDevice({
              ...descriptor,
              requiredLimits,
            });
          };

          return patchedAdapter;
        };
      }

      return true;
    } catch (err) {
      console.warn('提升WebGPU缓冲上限失败:', err);
      return false;
    }
  };

  // 获取服务器配置（下载功能开关）
  useEffect(() => {
    const fetchServerConfig = async () => {
      try {
        const response = await fetch('/api/server-config');
        if (response.ok) {
          const config = await response.json();
          setDownloadEnabled(config.DownloadEnabled ?? true);
        }
      } catch (error) {
        console.error('获取服务器配置失败:', error);
        // 出错时默认启用下载功能
        setDownloadEnabled(true);
      }
    };
    fetchServerConfig();
  }, []);

  useEffect(() => {
    anime4kEnabledRef.current = anime4kEnabled;
    anime4kModeRef.current = anime4kMode;
    anime4kScaleRef.current = anime4kScale;
  }, [anime4kEnabled, anime4kMode, anime4kScale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleLoad = () => setPageLoadComplete(true);

    if (document.readyState === 'complete') {
      handleLoad();
      return;
    }

    window.addEventListener('load', handleLoad, { once: true });
    return () => {
      window.removeEventListener('load', handleLoad);
    };
  }, []);

  // 获取 HLS 缓冲配置（根据用户设置的模式）
  const getHlsBufferConfig = () => {
    const mode =
      typeof window !== 'undefined'
        ? localStorage.getItem('playerBufferMode') || 'standard'
        : 'standard';

    switch (mode) {
      case 'enhanced':
        // 增强模式：1.5 倍缓冲
        return {
          maxBufferLength: 45, // 45s（默认30s × 1.5）
          backBufferLength: 45,
          maxBufferSize: 90 * 1000 * 1000, // 90MB
        };
      case 'max':
        // 强力模式：3 倍缓冲
        return {
          maxBufferLength: 90, // 90s（默认30s × 3）
          backBufferLength: 60,
          maxBufferSize: 180 * 1000 * 1000, // 180MB
        };
      case 'standard':
      default:
        // 默认模式
        return {
          maxBufferLength: 30,
          backBufferLength: 30,
          maxBufferSize: 60 * 1000 * 1000, // 60MB
        };
    }
  };

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(
    parseInt(searchParams.get('douban_id') || '0') || 0,
  );
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || '',
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(() => {
    // 从 URL 读取初始集数
    const indexParam = searchParams.get('index');
    return indexParam ? parseInt(indexParam, 10) : 0;
  });

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const availableSourcesRef = useRef<SearchResult[]>([]);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const videoDoubanIdRef = useRef(videoDoubanId);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // ✅ 合并所有 ref 同步的 useEffect - 减少不必要的渲染
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
    adFilterConfigRef.current = adFilterConfig;
    externalDanmuEnabledRef.current = externalDanmuEnabled;
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
    videoDoubanIdRef.current = videoDoubanId;
    availableSourcesRef.current = availableSources;
  }, [
    blockAdEnabled,
    adFilterConfig,
    externalDanmuEnabled,
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
    videoDoubanId,
    availableSources,
  ]);

  // 获取结构化去广告规则
  useEffect(() => {
    const fetchAdFilterConfig = async () => {
      try {
        const response = await fetch('/api/ad-filter');
        if (response.ok) {
          const data = await response.json();
          setAdFilterConfig(data);
        }
      } catch (error) {
        console.error('获取去广告规则失败:', error);
      }
    };

    fetchAdFilterConfig();
  }, []);

  // WebGPU支持检测
  useEffect(() => {
    const checkWebGPUSupport = async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：浏览器不支持WebGPU API');
        return;
      }

      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
          setWebGPUSupported(false);
          console.log('WebGPU不支持：无法获取GPU适配器');
          return;
        }

        setWebGPUSupported(true);
        console.log('WebGPU支持检测：✅ 支持');
      } catch (err) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：检测失败', err);
      }
    };

    checkWebGPUSupport();
  }, []);

  // 加载详情（豆瓣或bangumi）
  useEffect(() => {
    const loadMovieDetails = async () => {
      if (!videoDoubanId || videoDoubanId === 0) {
        return;
      }
      const now = Date.now();
      const oneMinute = 60 * 1000; // 1分钟 = 60秒 = 60000毫秒
      const shouldSkipRetry =
        lastMovieDetailsFetchTime > 0 &&
        now - lastMovieDetailsFetchTime < oneMinute;
      // 检测是否为bangumi ID
      if (isBangumiId(videoDoubanId)) {
        // 加载bangumi详情
        if (loadingBangumiDetails || bangumiDetails) {
          return;
        }

        // 🎯 防止频繁重试：如果上次请求在1分钟内，则跳过
        if (shouldSkipRetry) {
          console.log(
            `⏱️ 距离上次请求不足1分钟，跳过重试（${Math.floor((now - lastMovieDetailsFetchTime) / 1000)}秒前）`,
          );
          return;
        }

        setLoadingBangumiDetails(true);
        setLastMovieDetailsFetchTime(now); // 记录本次请求时间（与豆瓣共用）
        try {
          const bangumiData = await fetchBangumiDetails(videoDoubanId);
          if (bangumiData) {
            setBangumiDetails(bangumiData);
          } else if (!isBangumiId(videoDoubanId)) {
            // anime 类型但 bangumi 无数据，fallback 到豆瓣
            const response = await getDoubanDetails(videoDoubanId.toString());
            if (
              response.code === 200 &&
              response.list &&
              response.list[0] &&
              response.list[0].title
            ) {
              setMovieDetails(response.list);
            }
          }
        } catch (error) {
          console.error('Failed to load bangumi details:', error);
          // anime 类型 bangumi 失败时，fallback 到豆瓣
          if (!isBangumiId(videoDoubanId)) {
            try {
              const response = await getDoubanDetails(videoDoubanId.toString());
              if (
                response.code === 200 &&
                response.list &&
                response.list[0] &&
                response.list[0].title
              ) {
                setMovieDetails(response.list);
              }
            } catch (doubanError) {
              console.error(
                'Failed to load douban details as fallback:',
                doubanError,
              );
            }
          }
        } finally {
          setLoadingBangumiDetails(false);
        }
      } else {
        // 加载豆瓣详情
        if (loadingMovieDetails || movieDetails) {
          return;
        }

        // 🎯 防止频繁重试：如果上次请求在1分钟内，则跳过
        if (shouldSkipRetry) {
          console.log(
            `⏱️ 距离上次请求不足1分钟，跳过重试（${Math.floor((now - lastMovieDetailsFetchTime) / 1000)}秒前）`,
          );
          return;
        }

        setLoadingMovieDetails(true);
        setLastMovieDetailsFetchTime(now); // 记录本次请求时间
        try {
          const response = await getDoubanDetails(videoDoubanId.toString());
          // 🎯 只有在数据有效（title 存在）时才设置 movieDetails
          if (
            response.code === 200 &&
            response.list[0] &&
            response.list[0].title
          ) {
            setMovieDetails(response.list[0]);
          } else if (
            response.code === 200 &&
            response.list[0] &&
            !response.list[0].title
          ) {
            console.warn('⚠️ Douban 返回空数据（缺少标题），1分钟后将自动重试');
            setMovieDetails(null);
          }
        } catch (error) {
          console.error('Failed to load movie details:', error);
          setMovieDetails(null);
        } finally {
          setLoadingMovieDetails(false);
        }
      }
    };

    loadMovieDetails();
  }, [
    videoDoubanId,
    loadingMovieDetails,
    movieDetails,
    loadingBangumiDetails,
    bangumiDetails,
    lastMovieDetailsFetchTime,
    searchType,
  ]);

  // 加载豆瓣短评
  useEffect(() => {
    const loadComments = async () => {
      if (!videoDoubanId || videoDoubanId === 0) {
        return;
      }

      // 跳过bangumi ID
      if (isBangumiId(videoDoubanId)) {
        return;
      }

      // 如果已经加载过该ID的短评，不重复加载
      if (loadedCommentsIdRef.current === videoDoubanId) {
        return;
      }

      // 如果正在加载，也不重复加载
      if (loadingComments) {
        return;
      }

      setLoadingComments(true);
      setCommentsError(null);
      try {
        const response = await getDoubanComments({
          id: videoDoubanId.toString(),
          start: 0,
          limit: 10,
          sort: 'new_score',
        });

        if (response.code === 200 && response.data) {
          setMovieComments(response.data.comments);
        } else {
          setCommentsError(response.message);
        }
        // 标记该ID已加载
        loadedCommentsIdRef.current = videoDoubanId;
      } catch (error) {
        console.error('Failed to load comments:', error);
        setCommentsError('加载短评失败');
        // 即使失败也标记已加载，防止无限重试
        loadedCommentsIdRef.current = videoDoubanId;
      } finally {
        setLoadingComments(false);
      }
    };

    loadComments();
  }, [videoDoubanId, detail?.source]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;
  const filteredSources = availableSources.filter((source) => {
    // 必须有集数数据
    if (!source.episodes || source.episodes.length < 1) return false;
    // 如果当前有 detail，只显示集数相近的源（允许约30%的差异）
    if (detail && detail.episodes && detail.episodes.length > 0) {
      const currentEpisodes = detail.episodes.length;
      const sourceEpisodes = source.episodes.length;
      const tolerance = Math.max(5, Math.ceil(currentEpisodes * 0.3)); // 至少5集的容差
      // 在合理范围内
      return Math.abs(sourceEpisodes - currentEpisodes) <= tolerance;
    }
    return true;
  });
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null,
  );
  const [isSpeedTestRunning, setIsSpeedTestRunning] = useState(false);
  const [speedTestResetKey, setSpeedTestResetKey] = useState(0);
  const [pageLoadComplete, setPageLoadComplete] = useState(false);
  const [speedTestComplete, setSpeedTestComplete] = useState(false);

  const speedTestReady = pageLoadComplete && !loading;
  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return false;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const lastQueuedProgressRef = useRef<PlayProgressIdentity | null>(null);
  const [progressSaveQueue] = useState(() =>
    createLatestTaskQueue<PendingPlayProgress>(
      async ({ source, id, record, identity }) => {
        try {
          await savePlayRecord(source, id, record, { keepalive: true });
          console.log('播放进度已保存:', {
            id,
            source,
            title: record.title,
            episode: identity.episode,
            year: record.year,
            progress: `${identity.playTime}/${identity.totalTime}`,
          });
        } catch (error) {
          if (isSamePlayProgress(lastQueuedProgressRef.current, identity)) {
            lastQueuedProgressRef.current = null;
          }
          throw error;
        }
      },
    ),
  );

  // 弹幕加载状态管理，防止重复加载
  const danmuLoadingRef = useRef<boolean>(false);
  const lastDanmuLoadKeyRef = useRef<string>('');

  // 🚀 新增：弹幕操作防抖和性能优化
  const danmuOperationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const episodeSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const danmuPluginStateRef = useRef<any>(null); // 保存弹幕插件状态
  const isSourceChangingRef = useRef<boolean>(false); // 标记是否正在换源
  const isEpisodeChangingRef = useRef<boolean>(false); // 标记是否正在切换集数
  const isSkipControllerTriggeredRef = useRef<boolean>(false); // 标记是否通过 SkipController 触发了下一集
  const videoEndedHandledRef = useRef<boolean>(false); // 🔥 标记当前视频的 video:ended 事件是否已经被处理过（防止多个监听器重复触发）

  // 🚀 新增：连续切换源防抖和资源管理
  const sourceSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSwitchRef = useRef<any>(null); // 保存待处理的切换请求
  const switchPromiseRef = useRef<Promise<void> | null>(null); // 当前切换的Promise

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const trackedVideoElementsRef = useRef<Set<HTMLVideoElement>>(new Set());
  const playerInitRunIdRef = useRef(0);

  // 播放器就绪状态
  const [playerReady, setPlayerReady] = useState(false);

  // Wake Lock 相关
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 组件卸载状态引用
  const isUnmountedRef = useRef(false);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // bangumi ID检测（3-6位数字）
  const isBangumiId = (id: number): boolean => {
    const length = id.toString().length;
    return id > 0 && length >= 3 && length <= 6;
  };

  // 获取 Bangumi 详情；会话去重和服务端缓存由 API 层负责。
  const fetchBangumiDetails = async (bangumiId: number) => {
    try {
      const response = await fetch(
        `/api/proxy/bangumi?path=v0/subjects/${bangumiId}`,
      );
      if (response.ok) {
        const bangumiData = await response.json();
        return bangumiData;
      }
    } catch (error) {
      console.log('Failed to fetch bangumi details:', error);
    }
    return null;
  };

  // 检查是否包含查询中的所有关键词（与downstream评分逻辑保持一致）
  const checkAllKeywordsMatch = (
    queryTitle: string,
    resultTitle: string,
  ): boolean => {
    const queryWords = queryTitle
      .replace(/[^\w\s\u4e00-\u9fff]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0);

    // 检查结果标题是否包含查询中的所有关键词
    return queryWords.every((word) => resultTitle.includes(word));
  };

  // 网盘搜索函数
  const handleNetDiskSearch = async (query: string) => {
    if (!query.trim()) return;

    setNetdiskLoading(true);
    setNetdiskError(null);
    setNetdiskResults(null);
    setNetdiskTotal(0);

    try {
      const response = await fetch(
        `/api/netdisk/search?q=${encodeURIComponent(query.trim())}`,
      );
      const data = await response.json();

      if (data.success) {
        setNetdiskResults(data.data.merged_by_type || {});
        setNetdiskTotal(data.data.total || 0);
        console.log(
          `网盘搜索完成: "${query}" - ${data.data.total || 0} 个结果`,
        );
      } else {
        setNetdiskError(data.error || '网盘搜索失败');
      }
    } catch (error: any) {
      console.error('网盘搜索请求失败:', error);
      setNetdiskError('网盘搜索请求失败，请稍后重试');
    } finally {
      setNetdiskLoading(false);
    }
  };

  // 处理演员点击事件
  const handleCelebrityClick = async (celebrityName: string) => {
    // 如果点击的是已选中的演员，则收起
    if (selectedCelebrityName === celebrityName) {
      setSelectedCelebrityName(null);
      setCelebrityWorks([]);
      return;
    }

    setSelectedCelebrityName(celebrityName);
    setLoadingCelebrityWorks(true);
    setCelebrityWorks([]);

    try {
      console.log('搜索演员作品:', celebrityName);

      // 使用豆瓣搜索API（通过cmliussss CDN）
      const searchUrl = `https://movie.douban.cmliussss.net/j/search_subjects?type=movie&tag=${encodeURIComponent(celebrityName)}&sort=recommend&page_limit=20&page_start=0`;

      const response = await fetch(searchUrl);
      const data = await response.json();

      if (data.subjects && data.subjects.length > 0) {
        const works = data.subjects.map((item: any) => ({
          id: item.id,
          title: item.title,
          poster: item.cover,
          rate: item.rate,
          year: item.url?.match(/\/subject\/(\d+)\//)?.[1] || '',
          source: 'douban',
        }));
        setCelebrityWorks(works);
        console.log(
          `找到 ${works.length} 部 ${celebrityName} 的作品（豆瓣，已缓存）`,
        );
      } else {
        // 豆瓣没有结果，尝试TMDB fallback
        console.log('豆瓣未找到相关作品，尝试TMDB...');
        try {
          const tmdbResponse = await fetch(
            `/api/tmdb/actor?actor=${encodeURIComponent(celebrityName)}&type=movie&limit=20`,
          );
          const tmdbResult = await tmdbResponse.json();

          if (
            tmdbResult.code === 200 &&
            tmdbResult.list &&
            tmdbResult.list.length > 0
          ) {
            // 给TMDB作品添加source标记
            const worksWithSource = tmdbResult.list.map((work: any) => ({
              ...work,
              source: 'tmdb',
            }));
            setCelebrityWorks(worksWithSource);
            console.log(
              `找到 ${tmdbResult.list.length} 部 ${celebrityName} 的作品（TMDB，已缓存）`,
            );
          } else {
            console.log('TMDB也未找到相关作品');
            setCelebrityWorks([]);
          }
        } catch (tmdbError) {
          console.error('TMDB搜索失败:', tmdbError);
          setCelebrityWorks([]);
        }
      }
    } catch (error) {
      console.error('获取演员作品出错:', error);
      setCelebrityWorks([]);
    } finally {
      setLoadingCelebrityWorks(false);
    }
  };

  const isRetestDisabled =
    !speedTestReady ||
    isSpeedTestRunning ||
    sourceSearchLoading ||
    loading ||
    filteredSources.length === 0;

  // 轻量级优选：仅测试连通性，不创建video和HLS
  const lightweightPreference = async (
    sources: SearchResult[],
  ): Promise<SearchResult> => {
    if (sources.length <= 1) return sources[0];
    console.log('开始轻量级测速，仅测试连通性');
    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          if (!source.episodes || source.episodes.length === 0) {
            return { source, pingTime: 9999, available: false };
          }

          const episodeUrl =
            source.episodes.length > 1
              ? source.episodes[1]
              : source.episodes[0];

          // 仅测试连通性和响应时间
          const startTime = performance.now();
          await fetch(episodeUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: AbortSignal.timeout(3000), // 3秒超时
          });
          const pingTime = performance.now() - startTime;

          return {
            source,
            pingTime: Math.round(pingTime),
            available: true,
          };
        } catch (error) {
          console.warn(`轻量级测速失败: ${source.source_name}`, error);
          return { source, pingTime: 9999, available: false };
        }
      }),
    );
    const sorted = results
      .filter((item) => item.available)
      .sort((a, b) => a.pingTime - b.pingTime);
    return sorted.length > 0 ? sorted[0].source : sources[0];
  };

  // 完整测速（桌面设备）
  const fullSpeedTest = async (sources: SearchResult[]): Promise<void> => {
    if (
      !speedTestReady ||
      isSpeedTestRunning ||
      sourceSearchLoading ||
      loading ||
      sources.length === 0
    ) {
      return;
    }
    // 桌面设备使用小批量并发，避免创建过多实例
    const concurrency = 2;
    setIsSpeedTestRunning(true);
    setPrecomputedVideoInfo(new Map());
    setSpeedTestResetKey((prev) => prev + 1);
    setSpeedTestComplete(true);

    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    let testedCount = 0; // 已测试数量

    for (let i = 0; i < sources.length; i += concurrency) {
      // 检查组件是否已卸载
      if (isUnmountedRef.current) {
        console.log('组件已卸载，终止测速');
        break;
      }

      const batch = sources.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (source) => {
          // 再次检查组件是否已卸载
          if (isUnmountedRef.current) return null;

          try {
            if (!source.episodes || source.episodes.length === 0) {
              return null;
            }
            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);
            return { source, testResult };
          } catch (error) {
            console.warn(`测速失败: ${source.source_name}`, error);
            return null;
          }
        }),
      );
      allResults.push(...batchResults);
      testedCount += batch.length;
      // 批次间延迟，让资源有时间清理（减少延迟时间）
      if (i + concurrency < sources.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // 如果组件已卸载，不更新状态
    if (isUnmountedRef.current) {
      return;
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    setPrecomputedVideoInfo(newVideoInfoMap);
    setIsSpeedTestRunning(false);

    // // 过滤出成功的结果用于优选计算
    // const successfulResults = allResults.filter(Boolean) as Array<{
    //   source: SearchResult;
    //   testResult: { quality: string; loadSpeed: string; pingTime: number };
    // }>;

    // if (successfulResults.length === 0) {
    //   console.warn('所有播放源测速都失败，使用第一个播放源');
    //   return sources[0];
    // }

    // // 找出所有有效速度的最大值，用于线性映射
    // const validSpeeds = successfulResults
    //   .map((result) => {
    //     const speedStr = result.testResult.loadSpeed;
    //     if (speedStr === '未知' || speedStr === '测量中...') return 0;

    //     const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    //     if (!match) return 0;

    //     const value = parseFloat(match[1]);
    //     const unit = match[2];
    //     return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
    //   })
    //   .filter((speed) => speed > 0);

    // const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // // 找出所有有效延迟的最小值和最大值，用于线性映射
    // const validPings = successfulResults
    //   .map((result) => result.testResult.pingTime)
    //   .filter((ping) => ping > 0);

    // const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    // const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // // 计算每个结果的评分
    // const resultsWithScore = successfulResults.map((result) => ({
    //   ...result,
    //   score: calculateSourceScore(
    //     result.testResult,
    //     maxSpeed,
    //     minPing,
    //     maxPing,
    //   ),
    // }));

    // // 按综合评分排序，选择最佳播放源
    // resultsWithScore.sort((a, b) => b.score - a.score);

    // console.log('播放源评分排序结果:');
    // resultsWithScore.forEach((result, index) => {
    //   console.log(
    //     `${index + 1}. ${
    //       result.source.source_name
    //     } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
    //       result.testResult.loadSpeed
    //     }, ${result.testResult.pingTime}ms)`,
    //   );
    // });

    // return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number,
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 更新视频地址
  const updateVideoUrl = async (
    detailData: SearchResult | null,
    episodeIndex: number,
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    // 规范URL参数
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('source', detailData.source);
    newUrl.searchParams.set('id', detailData.id);
    newUrl.searchParams.set('year', detailData.year);
    newUrl.searchParams.set('title', detailData.title);
    newUrl.searchParams.set('index', episodeIndex.toString());
    newUrl.searchParams.delete('prefer');
    window.history.replaceState({}, '', newUrl.toString());
    const episodeData = detailData.episodes[episodeIndex];
    // 普通视频格式
    const newVideoUrl = episodeData || '';
    if (newVideoUrl !== videoUrl) {
      setVideoUrl(newVideoUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 检测移动设备（在组件层级定义）- 参考ArtPlayer compatibility.js
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOSGlobal =
    /iPad|iPhone|iPod/i.test(userAgent) && !(window as any).MSStream;
  const isIOS13Global =
    isIOSGlobal ||
    (userAgent.includes('Macintosh') && navigator.maxTouchPoints >= 1);
  const isMobileGlobal =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent,
    ) || isIOS13Global;

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen',
        );
        console.log('Wake Lock 已启用');
      }
    } catch (err) {
      console.warn('Wake Lock 请求失败:', err);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 已释放');
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  const trackVideoElement = (video: HTMLVideoElement | null | undefined) => {
    if (video) {
      trackedVideoElementsRef.current.add(video);
    }
  };

  const stopVideoElement = (video: HTMLVideoElement | null | undefined) => {
    if (!video) return;

    try {
      video.pause();
    } catch (err) {
      console.warn('暂停视频元素时出错:', err);
    }

    if (video.hls) {
      try {
        video.hls.stopLoad();
        video.hls.detachMedia();
        video.hls.destroy();
        video.hls = null;
        console.log('HLS实例已停止并销毁');
      } catch (hlsError) {
        console.warn('停止HLS实例时出错:', hlsError);
        video.hls = null;
      }
    }

    try {
      Array.from(video.getElementsByTagName('source')).forEach((source) =>
        source.remove(),
      );

      if ('srcObject' in video && video.srcObject) {
        video.srcObject = null;
      }

      video.removeAttribute('src');
      video.load();
    } catch (err) {
      console.warn('清空视频源时出错:', err);
    }
  };

  const stopPlayerMedia = (player: any = artPlayerRef.current) => {
    try {
      if (player && typeof player.pause === 'function') {
        player.pause();
      }
    } catch (err) {
      console.warn('暂停播放器时出错:', err);
    }

    const playerVideo = player?.video as HTMLVideoElement | undefined;
    trackVideoElement(playerVideo);
    stopVideoElement(playerVideo);

    trackedVideoElementsRef.current.forEach((video) => {
      stopVideoElement(video);
    });
    trackedVideoElementsRef.current.clear();

    if (artRef.current) {
      artRef.current
        .querySelectorAll('video')
        .forEach((video) => stopVideoElement(video));
    }
  };

  // 清理播放器资源的统一函数
  const cleanupPlayer = async () => {
    const player = artPlayerRef.current;
    stopPlayerMedia(player);

    // 先清理Anime4K，避免GPU纹理错误
    await cleanupAnime4K();

    // 🚀 新增：清理弹幕优化相关的定时器
    if (danmuOperationTimeoutRef.current) {
      clearTimeout(danmuOperationTimeoutRef.current);
      danmuOperationTimeoutRef.current = null;
    }

    if (episodeSwitchTimeoutRef.current) {
      clearTimeout(episodeSwitchTimeoutRef.current);
      episodeSwitchTimeoutRef.current = null;
    }

    // 清理弹幕状态引用
    danmuPluginStateRef.current = null;

    if (player) {
      try {
        // 1. 清理弹幕插件的WebWorker
        if (player.plugins?.artplayerPluginDanmuku) {
          const danmukuPlugin = player.plugins.artplayerPluginDanmuku;

          // 尝试获取并清理WebWorker
          if (
            danmukuPlugin.worker &&
            typeof danmukuPlugin.worker.terminate === 'function'
          ) {
            danmukuPlugin.worker.terminate();
            console.log('弹幕WebWorker已清理');
          }

          // 清空弹幕数据
          if (typeof danmukuPlugin.reset === 'function') {
            danmukuPlugin.reset();
          }
        }

        // 2. 销毁HLS实例
        if (player.video?.hls) {
          try {
            // 先停止加载，避免请求中断导致的网络错误
            player.video.hls.stopLoad();
            player.video.hls.detachMedia();
            player.video.hls.destroy();
            // 清除 video 元素上的 hls 引用
            player.video.hls = null;
            console.log('HLS实例已销毁');
          } catch (hlsError) {
            console.warn('销毁HLS实例时出错:', hlsError);
          }
        }

        // 3. 销毁ArtPlayer实例，视频源已在 stopPlayerMedia 中同步清空
        player.destroy(false);
        if (artPlayerRef.current === player) {
          artPlayerRef.current = null;
        }
        if (!isUnmountedRef.current) {
          setPlayerReady(false);
        }

        console.log('播放器资源已清理');
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        // 即使出错也要确保引用被清空
        if (artPlayerRef.current === player) {
          artPlayerRef.current = null;
        }
        if (!isUnmountedRef.current) {
          setPlayerReady(false);
        }
      }
    }
  };

  // 初始化Anime4K超分
  const initAnime4K = async () => {
    if (!artPlayerRef.current?.video) return false;

    let frameRequestId: number | null = null;
    let outputCanvas: HTMLCanvasElement | null = null;

    try {
      if (anime4kRef.current) {
        anime4kRef.current.controller?.stop?.();
        anime4kRef.current = null;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const video = artPlayerRef.current.video as HTMLVideoElement;

      if (!video.videoWidth || !video.videoHeight) {
        console.warn('视频尺寸未就绪，等待loadedmetadata事件');
        await new Promise<void>((resolve) => {
          const handler = () => {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          };
          video.addEventListener('loadedmetadata', handler);
          if (video.videoWidth && video.videoHeight) {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          }
        });
      }

      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('无法获取视频尺寸');
      }

      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
      outputCanvas = document.createElement('canvas');
      const container = artPlayerRef.current.template.$video.parentElement;

      const requestedScale = anime4kScaleRef.current;
      const requiredBytes = estimateAnime4KBufferBytes(
        video.videoWidth,
        video.videoHeight,
        requestedScale,
      );
      const scale = requestedScale;

      if (requiredBytes > ANIME4K_DEFAULT_MAX_BUFFER_BYTES) {
        await ensureAnime4KMaxBufferLimit(requiredBytes);
      }
      outputCanvas.width = Math.floor(video.videoWidth * scale);
      outputCanvas.height = Math.floor(video.videoHeight * scale);

      if (
        !outputCanvas.width ||
        !outputCanvas.height ||
        !isFinite(outputCanvas.width) ||
        !isFinite(outputCanvas.height)
      ) {
        throw new Error(
          `outputCanvas尺寸无效: ${outputCanvas.width}x${outputCanvas.height}`,
        );
      }

      outputCanvas.style.position = 'absolute';
      outputCanvas.style.top = '0';
      outputCanvas.style.left = '0';
      outputCanvas.style.width = '100%';
      outputCanvas.style.height = '100%';
      outputCanvas.style.objectFit = 'contain';
      outputCanvas.style.cursor = 'pointer';
      outputCanvas.style.zIndex = '1';
      outputCanvas.style.backgroundColor = 'transparent';

      let sourceCanvas: HTMLCanvasElement | null = null;
      let sourceCtx: CanvasRenderingContext2D | null = null;

      if (isFirefox) {
        sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = Math.floor(video.videoWidth);
        sourceCanvas.height = Math.floor(video.videoHeight);

        if (!sourceCanvas.width || !sourceCanvas.height) {
          throw new Error(
            `sourceCanvas尺寸无效: ${sourceCanvas.width}x${sourceCanvas.height}`,
          );
        }

        // 兼容 anime4k-webgpu 期望的 videoWidth/videoHeight
        try {
          (sourceCanvas as any).videoWidth = sourceCanvas.width;
          (sourceCanvas as any).videoHeight = sourceCanvas.height;
        } catch (err) {
          console.warn('无法设置sourceCanvas视频尺寸字段:', err);
        }

        sourceCtx = sourceCanvas.getContext('2d', {
          willReadFrequently: true,
          alpha: false,
        });
        if (!sourceCtx) throw new Error('无法创建2D上下文');

        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          sourceCtx.drawImage(
            video,
            0,
            0,
            sourceCanvas.width,
            sourceCanvas.height,
          );
        }
      }

      const handleCanvasClick = () => {
        if (artPlayerRef.current) artPlayerRef.current.toggle();
      };
      outputCanvas.addEventListener('click', handleCanvasClick);

      const handleCanvasDblClick = () => {
        if (artPlayerRef.current)
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
      };
      outputCanvas.addEventListener('dblclick', handleCanvasDblClick);

      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.position = 'absolute';
      video.style.zIndex = '-1';

      container.insertBefore(outputCanvas, video);

      if (isFirefox && sourceCtx && sourceCanvas) {
        // 🚀 性能优化：添加帧率限制，降低 CPU 占用
        let lastFrameTime = 0;
        const targetFPS = 30; // 从 60fps 降到 30fps，降低约 50% CPU 占用
        const frameInterval = 1000 / targetFPS;

        const captureVideoFrame = () => {
          const now = performance.now();

          // 只在达到目标帧间隔时才执行绘制
          if (now - lastFrameTime >= frameInterval) {
            if (
              sourceCtx &&
              sourceCanvas &&
              video.readyState >= video.HAVE_CURRENT_DATA
            ) {
              sourceCtx.drawImage(
                video,
                0,
                0,
                sourceCanvas.width,
                sourceCanvas.height,
              );
            }
            lastFrameTime = now - ((now - lastFrameTime) % frameInterval);
          }

          frameRequestId = requestAnimationFrame(captureVideoFrame);
        };
        captureVideoFrame();
      }

      const renderInput = isFirefox ? sourceCanvas : video;
      if (!renderInput) throw new Error('无法获取超分输入源');
      ensureRequestVideoFrameCallback(renderInput);
      (renderInput as any).__anime4kFrameCallbackEnabled = true;

      const {
        render: anime4kRender,
        ModeA,
        ModeB,
        ModeC,
        ModeAA,
        ModeBB,
        ModeCA,
      } = await import(/* webpackPreload: false */ 'anime4k-webgpu');

      let ModeClass: any;
      const modeName = anime4kModeRef.current;

      switch (modeName) {
        case 'ModeA':
          ModeClass = ModeA;
          break;
        case 'ModeB':
          ModeClass = ModeB;
          break;
        case 'ModeC':
          ModeClass = ModeC;
          break;
        case 'ModeAA':
          ModeClass = ModeAA;
          break;
        case 'ModeBB':
          ModeClass = ModeBB;
          break;
        case 'ModeCA':
          ModeClass = ModeCA;
          break;
        default:
          ModeClass = ModeA;
      }

      const renderConfig: any = {
        video: renderInput,
        canvas: outputCanvas,
        pipelineBuilder: (device: GPUDevice, inputTexture: GPUTexture) => {
          if (!outputCanvas) throw new Error('outputCanvas is null');
          const mode = new ModeClass({
            device,
            inputTexture,
            nativeDimensions: {
              width: Math.floor(video.videoWidth),
              height: Math.floor(video.videoHeight),
            },
            targetDimensions: {
              width: Math.floor(outputCanvas.width),
              height: Math.floor(outputCanvas.height),
            },
          });
          return [mode];
        },
      };

      const controller = await anime4kRender(renderConfig);

      anime4kRef.current = {
        controller,
        canvas: outputCanvas,
        sourceCanvas: isFirefox ? sourceCanvas : null,
        frameRequestId: isFirefox ? frameRequestId : null,
        handleCanvasClick,
        handleCanvasDblClick,
        renderInput,
      };

      console.log(
        'Anime4K超分已启用，模式:',
        anime4kModeRef.current,
        '倍数:',
        scale,
      );
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = `超分已启用 (${anime4kModeRef.current}, ${scale}x)`;
      }
      return true;
    } catch (err) {
      console.error('初始化Anime4K失败:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show =
          '超分启用失败：' + (err instanceof Error ? err.message : '未知错误');
      }

      if (frameRequestId) cancelAnimationFrame(frameRequestId);
      if (outputCanvas && outputCanvas.parentNode) {
        outputCanvas.parentNode.removeChild(outputCanvas);
      }

      if (artPlayerRef.current?.video) {
        artPlayerRef.current.video.style.opacity = '1';
        artPlayerRef.current.video.style.pointerEvents = 'auto';
        artPlayerRef.current.video.style.position = '';
        artPlayerRef.current.video.style.zIndex = '';
      }
      return false;
    }
  };

  // 清理Anime4K
  const cleanupAnime4K = async () => {
    if (anime4kRef.current) {
      try {
        if (anime4kRef.current.frameRequestId) {
          cancelAnimationFrame(anime4kRef.current.frameRequestId);
        }

        anime4kRef.current.controller?.stop?.();

        if (anime4kRef.current.canvas) {
          if (anime4kRef.current.handleCanvasClick) {
            anime4kRef.current.canvas.removeEventListener(
              'click',
              anime4kRef.current.handleCanvasClick,
            );
          }
          if (anime4kRef.current.handleCanvasDblClick) {
            anime4kRef.current.canvas.removeEventListener(
              'dblclick',
              anime4kRef.current.handleCanvasDblClick,
            );
          }
        }

        if (anime4kRef.current.canvas && anime4kRef.current.canvas.parentNode) {
          anime4kRef.current.canvas.parentNode.removeChild(
            anime4kRef.current.canvas,
          );
        }

        if (anime4kRef.current.renderInput) {
          const renderInput = anime4kRef.current.renderInput as any;
          renderInput.__anime4kFrameCallbackEnabled = false;
          if (
            typeof renderInput.cancelVideoFrameCallback === 'function' &&
            renderInput.__anime4kFrameCallbackHandle != null
          ) {
            renderInput.cancelVideoFrameCallback(
              renderInput.__anime4kFrameCallbackHandle,
            );
          }
          renderInput.__anime4kFrameCallbackHandle = null;
        }

        if (anime4kRef.current.sourceCanvas) {
          const ctx = anime4kRef.current.sourceCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(
              0,
              0,
              anime4kRef.current.sourceCanvas.width,
              anime4kRef.current.sourceCanvas.height,
            );
          }
        }

        anime4kRef.current = null;

        if (artPlayerRef.current?.video) {
          artPlayerRef.current.video.style.opacity = '1';
          artPlayerRef.current.video.style.pointerEvents = 'auto';
          artPlayerRef.current.video.style.position = '';
          artPlayerRef.current.video.style.zIndex = '';
        }

        console.log('Anime4K已清理');
      } catch (err) {
        console.warn('清理Anime4K时出错:', err);
      }
    }
  };

  // 切换Anime4K状态
  const toggleAnime4K = async (enabled: boolean) => {
    try {
      if (enabled) {
        const ok = await initAnime4K();
        if (!ok) {
          setAnime4kEnabled(false);
          localStorage.setItem('enable_anime4k', 'false');
          return;
        }
      } else {
        await cleanupAnime4K();
      }
      setAnime4kEnabled(enabled);
      localStorage.setItem('enable_anime4k', String(enabled));
    } catch (err) {
      console.error('切换超分状态失败:', err);
    }
  };

  // 更改Anime4K模式
  const changeAnime4KMode = async (mode: string) => {
    try {
      setAnime4kMode(mode);
      localStorage.setItem('anime4k_mode', mode);

      if (anime4kEnabledRef.current) {
        await cleanupAnime4K();
        const ok = await initAnime4K();
        if (!ok) {
          setAnime4kEnabled(false);
          localStorage.setItem('enable_anime4k', 'false');
        }
      }
    } catch (err) {
      console.error('更改超分模式失败:', err);
    }
  };

  // 更改Anime4K分辨率倍数
  const changeAnime4KScale = async (scale: number) => {
    try {
      setAnime4kScale(scale);
      localStorage.setItem('anime4k_scale', scale.toString());

      if (anime4kEnabledRef.current) {
        await cleanupAnime4K();
        const ok = await initAnime4K();
        if (!ok) {
          setAnime4kEnabled(false);
          localStorage.setItem('enable_anime4k', 'false');
        }
      }
    } catch (err) {
      console.error('更改超分倍数失败:', err);
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    return filterM3u8Ads(
      currentSourceRef.current,
      m3u8Content,
      adFilterConfigRef.current,
    );
  }

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any,
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  // 🚀 优化的弹幕操作处理函数（防抖 + 性能优化）
  const handleDanmuOperationOptimized = (nextState: boolean) => {
    // 清除之前的防抖定时器
    if (danmuOperationTimeoutRef.current) {
      clearTimeout(danmuOperationTimeoutRef.current);
    }

    // 立即更新UI状态（确保响应性）
    externalDanmuEnabledRef.current = nextState;
    setExternalDanmuEnabled(nextState);

    // 同步保存到localStorage（快速操作）
    try {
      localStorage.setItem('enable_external_danmu', String(nextState));
    } catch (e) {
      console.warn('localStorage设置失败:', e);
    }

    // 防抖处理弹幕数据操作（避免频繁切换时的性能问题）
    danmuOperationTimeoutRef.current = setTimeout(async () => {
      try {
        if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
          const plugin = artPlayerRef.current.plugins.artplayerPluginDanmuku;

          if (nextState) {
            // 开启弹幕：使用更温和的加载方式
            console.log('🚀 优化后开启外部弹幕...');

            // 使用requestIdleCallback优化性能（如果可用）
            const loadDanmu = async () => {
              const externalDanmu = await loadExternalDanmu();
              // 二次确认状态，防止快速切换导致的状态不一致
              if (
                externalDanmuEnabledRef.current &&
                artPlayerRef.current?.plugins?.artplayerPluginDanmuku
              ) {
                plugin.load(externalDanmu);
                plugin.show();
                console.log(
                  '✅ 外部弹幕已优化加载:',
                  externalDanmu.length,
                  '条',
                );

                if (artPlayerRef.current && externalDanmu.length > 0) {
                  artPlayerRef.current.notice.show = `已加载 ${externalDanmu.length} 条弹幕`;
                }
              }
            };

            // 使用 requestIdleCallback 或 setTimeout 来确保不阻塞主线程
            if (typeof requestIdleCallback !== 'undefined') {
              requestIdleCallback(loadDanmu, { timeout: 1000 });
            } else {
              setTimeout(loadDanmu, 50);
            }
          } else {
            // 关闭弹幕：立即处理
            console.log('🚀 优化后关闭外部弹幕...');
            plugin.load(); // 不传参数，真正清空弹幕
            plugin.hide();
            console.log('✅ 外部弹幕已关闭');

            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = '外部弹幕已关闭';
            }
          }
        }
      } catch (error) {
        console.error('优化后弹幕操作失败:', error);
      }
    }, 300); // 300ms防抖延迟
  };

  // 加载外部弹幕数据（带缓存和防重复）
  const loadExternalDanmu = async (): Promise<any[]> => {
    if (!externalDanmuEnabledRef.current) {
      console.log('外部弹幕开关已关闭');
      return [];
    }

    // 生成当前请求的唯一标识
    const currentVideoTitle = videoTitle;
    const currentVideoYear = videoYear;
    const currentVideoDoubanId = videoDoubanId;
    const currentEpisodeNum = currentEpisodeIndex + 1;
    const requestKey = `${currentVideoTitle}_${currentVideoYear}_${currentVideoDoubanId}_${currentEpisodeNum}`;

    // 🚀 优化加载状态检测：更智能的卡住检测
    const now = Date.now();
    const loadingState = danmuLoadingRef.current as any;
    const lastLoadTime = loadingState?.timestamp || 0;
    const lastRequestKey = loadingState?.requestKey || '';
    const isStuckLoad = now - lastLoadTime > 15000; // 降低到15秒超时
    const isSameRequest = lastRequestKey === requestKey;

    // 智能重复检测：区分真正的重复和卡住的请求
    if (loadingState?.loading && isSameRequest && !isStuckLoad) {
      console.log('⏳ 弹幕正在加载中，跳过重复请求');
      return [];
    }

    // 强制重置卡住的加载状态
    if (isStuckLoad && loadingState?.loading) {
      console.warn('🔧 检测到弹幕加载超时，强制重置 (15秒)');
      danmuLoadingRef.current = false;
    }

    // 设置新的加载状态，包含更多上下文信息
    danmuLoadingRef.current = {
      loading: true,
      timestamp: now,
      requestKey,
      source: currentSource,
      episode: currentEpisodeNum,
    } as any;
    lastDanmuLoadKeyRef.current = requestKey;

    try {
      const params = new URLSearchParams();

      // 使用当前最新的state值而不是ref值
      const currentVideoTitle = videoTitle;
      const currentVideoYear = videoYear;
      const currentVideoDoubanId = videoDoubanId;
      const currentEpisodeNum = currentEpisodeIndex + 1;

      if (currentVideoDoubanId && currentVideoDoubanId > 0) {
        params.append('douban_id', currentVideoDoubanId.toString());
      }
      if (currentVideoTitle) {
        params.append('title', currentVideoTitle);
      }
      if (currentVideoYear) {
        params.append('year', currentVideoYear);
      }
      if (currentEpisodeIndex !== null && currentEpisodeIndex >= 0) {
        params.append('episode', currentEpisodeNum.toString());
      }

      if (!params.toString()) {
        console.log('没有可用的参数获取弹幕');
        return [];
      }
      const response = await fetch(`/api/danmu-external?${params}`);
      console.log('弹幕API响应状态:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('弹幕API请求失败:', response.status, errorText);
        return [];
      }

      const data = await response.json();
      console.log('外部弹幕加载成功:', data.total || 0, '条');

      const finalDanmu = data.danmu || [];
      return finalDanmu;
    } catch (error) {
      console.error('加载外部弹幕失败:', error);
      return [];
    } finally {
      // 重置加载状态
      danmuLoadingRef.current = false;
    }
  };

  // 🚀 优化的集数变化处理（防抖 + 状态保护）
  useEffect(() => {
    // 🔥 标记正在切换集数（只在非换源时）
    if (!isSourceChangingRef.current) {
      isEpisodeChangingRef.current = true;
      // 🔑 立即重置 SkipController 触发标志，允许新集数自动跳过片头片尾
      isSkipControllerTriggeredRef.current = false;
      videoEndedHandledRef.current = false;
      console.log('🔄 开始切换集数，重置自动跳过标志');
    }

    updateVideoUrl(detail, currentEpisodeIndex);

    // 🚀 如果正在换源，跳过弹幕处理（换源会在完成后手动处理）
    if (isSourceChangingRef.current) {
      console.log('⏭️ 正在换源，跳过弹幕处理');
      return;
    }

    // 🔥 关键修复：重置弹幕加载标识，确保新集数能正确加载弹幕
    lastDanmuLoadKeyRef.current = '';
    danmuLoadingRef.current = false; // 重置加载状态

    // 清除之前的集数切换定时器，防止重复执行
    if (episodeSwitchTimeoutRef.current) {
      clearTimeout(episodeSwitchTimeoutRef.current);
    }

    // 如果播放器已经存在且弹幕插件已加载，重新加载弹幕
    if (
      artPlayerRef.current &&
      artPlayerRef.current.plugins?.artplayerPluginDanmuku
    ) {
      console.log('🚀 集数变化，优化后重新加载弹幕');

      // 🔥 关键修复：立即清空当前弹幕，避免旧弹幕残留
      const plugin = artPlayerRef.current.plugins.artplayerPluginDanmuku;
      plugin.reset(); // 立即回收所有正在显示的弹幕DOM
      plugin.load(); // 不传参数，完全清空弹幕队列
      console.log('🧹 已清空旧弹幕数据');

      // 保存当前弹幕插件状态
      danmuPluginStateRef.current = {
        isHide: artPlayerRef.current.plugins.artplayerPluginDanmuku.isHide,
        isStop: artPlayerRef.current.plugins.artplayerPluginDanmuku.isStop,
        option: artPlayerRef.current.plugins.artplayerPluginDanmuku.option,
      };

      // 使用防抖处理弹幕重新加载
      episodeSwitchTimeoutRef.current = setTimeout(async () => {
        try {
          // 确保播放器和插件仍然存在（防止快速切换时的状态不一致）
          if (!artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
            console.warn('⚠️ 集数切换后弹幕插件不存在，跳过弹幕加载');
            return;
          }
          const externalDanmu = await loadExternalDanmu(); // 这里会检查开关状态

          // 再次确认插件状态
          if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
            const plugin = artPlayerRef.current.plugins.artplayerPluginDanmuku;

            if (externalDanmu.length > 0) {
              console.log(
                '✅ 向播放器插件重新加载弹幕数据:',
                externalDanmu.length,
                '条',
              );
              plugin.load(externalDanmu);
              // 恢复弹幕插件的状态
              if (danmuPluginStateRef.current) {
                if (!danmuPluginStateRef.current.isHide) {
                  plugin.show();
                }
              }
              if (artPlayerRef.current) {
                artPlayerRef.current.notice.show = `已加载 ${externalDanmu.length} 条弹幕`;
              }
            } else {
              plugin.load(); // 不传参数，确保清空弹幕
              if (artPlayerRef.current) {
                artPlayerRef.current.notice.show = '暂无弹幕数据';
              }
            }
          }
        } catch (error) {
          console.error('❌ 集数变化后加载外部弹幕失败:', error);
        } finally {
          // 清理定时器引用
          episodeSwitchTimeoutRef.current = null;
        }
      }, 800); // 缩短延迟时间，提高响应性
    }
  }, [detail, currentEpisodeIndex]);

  const normalizeSources = (
    sources: Array<SearchResult | null | undefined>,
  ): SearchResult[] =>
    sources.filter((source): source is SearchResult => Boolean(source));

  const fetchSourceDetail = async (
    source: string,
    id: string,
  ): Promise<SearchResult[]> => {
    try {
      let detailData: SearchResult;
      const response = await fetch(
        `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`,
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || '获取视频详情失败');
      }
      detailData = await response.json();
      const normalized = normalizeSources([detailData]);
      setAvailableSources(normalized);
      return normalized;
    } catch (err) {
      console.error('获取视频详情失败:', err);
      return [];
    } finally {
      setSourceSearchLoading(false);
    }
  };

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const searchSourcesData = async (
      query: string,
    ): Promise<SearchResult[]> => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        if (!response.ok) {
          setSourceSearchError('未找到匹配结果');
          setAvailableSources([]);
          return [];
        }
        const data = await response.json();

        const results: SearchResult[] = data.results;

        if (!results || results.length <= 0) {
          setSourceSearchError('未找到匹配结果');
          setAvailableSources([]);
          return [];
        }
        const searchVariants = generateSearchVariants(query);
        let filteredResults = results.filter((result: SearchResult) => {
          // 如果有 douban_id，优先使用 douban_id 精确匹配
          if (
            videoDoubanIdRef.current &&
            videoDoubanIdRef.current > 0 &&
            result.douban_id
          ) {
            return result.douban_id === videoDoubanIdRef.current;
          }
          const queryTitle = videoTitleRef.current
            .replaceAll(' ', '')
            .toLowerCase();
          const resultTitle = result.title.replaceAll(' ', '').toLowerCase();
          const titleMatch =
            resultTitle === queryTitle ||
            searchVariants.some((v) => v.toLowerCase() === resultTitle);
          const yearMatch = matchesRequestedYear(
            videoYearRef.current,
            result.year,
          );
          const typeMatch = searchType
            ? (searchType === 'tv' && result.episodes.length > 1) ||
              (searchType === 'movie' && result.episodes.length === 1) ||
              searchType === 'anime'
            : true;
          return titleMatch && yearMatch && typeMatch;
        });
        filteredResults =
          filteredResults.length > 0
            ? filteredResults
            : results.filter((result: SearchResult) => {
                const queryTitle = videoTitleRef.current
                  .replaceAll(' ', '')
                  .toLowerCase();
                const resultTitle = result.title
                  .replaceAll(' ', '')
                  .toLowerCase();
                // 智能标题匹配：支持数字变体和标点符号变化
                // 优先使用精确包含匹配，避免短标题（如"玫瑰"）匹配到包含该字的其他电影（如"玫瑰的故事"）
                const titleMatch =
                  resultTitle.includes(queryTitle) ||
                  queryTitle.includes(resultTitle) ||
                  // 移除数字和标点后匹配（针对"死神来了：血脉诅咒" vs "死神来了6：血脉诅咒"）
                  resultTitle.replace(/\d+|[：:]/g, '') ===
                    queryTitle.replace(/\d+|[：:]/g, '') ||
                  // 通用关键词匹配：仅当查询标题较长时（4个字符以上）才使用关键词匹配
                  // 避免短标题（如"玫瑰"2字）被拆分匹配
                  (queryTitle.length > 4 &&
                    checkAllKeywordsMatch(queryTitle, resultTitle));
                const yearMatch = matchesRequestedYear(
                  videoYearRef.current,
                  result.year,
                );
                const typeMatch = searchType
                  ? (searchType === 'tv' && result.episodes.length > 1) ||
                    (searchType === 'movie' && result.episodes.length === 1) ||
                    searchType === 'anime'
                  : true;
                return titleMatch && yearMatch && typeMatch;
              });
        if (!filteredResults || filteredResults.length <= 0) {
          setSourceSearchError('未找到匹配结果');
          setAvailableSources([]);
          return [];
        }
        return filteredResults;
      } catch (err) {
        console.error('智能搜索失败:', err);
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setError(null);
      setLoading(true);
      setPlayerReady(false);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...',
      );

      // 🚀 性能优化：提前预加载 ArtPlayer 模块，与数据获取并行执行
      // 这样可以显著减少首次进入播放页的等待时间
      // 如果全局变量已存在（由首页预加载），则直接跳过
      const preloadPlayerPromise =
        (window as any).DynamicArtplayer &&
        (window as any).DynamicArtplayerPluginDanmuku
          ? Promise.resolve()
          : Promise.all([
              import(/* webpackPreload: false */ 'artplayer'),
              import(/* webpackPreload: false */ 'artplayer-plugin-danmuku'),
            ])
              .then(
                ([
                  { default: Artplayer },
                  { default: artplayerPluginDanmuku },
                ]) => {
                  // 将导入的模块设置为全局变量供后续使用
                  (window as any).DynamicArtplayer = Artplayer;
                  (window as any).DynamicArtplayerPluginDanmuku =
                    artplayerPluginDanmuku;
                  console.log('✅ ArtPlayer 模块预加载完成');
                },
              )
              .catch((error) => {
                console.error('⚠️ ArtPlayer 预加载失败:', error);
                // 预加载失败不影响后续流程，initPlayer 时会重新尝试
              });
      let searchResult: SearchResult[] = await searchSourcesData(
        videoTitle || searchTitle,
      );
      if (
        currentSource &&
        currentId &&
        !searchResult.some(
          (source) =>
            source.source === currentSource && source.id === currentId,
        )
      ) {
        searchResult = await fetchSourceDetail(currentSource, currentId);
      }
      searchResult = normalizeSources(searchResult);
      if (searchResult.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }
      setAvailableSources(searchResult);
      let detailData: SearchResult;
      // 指定源和id则优先使用指定源
      if (currentSource && currentId) {
        const target = searchResult.find(
          (source) =>
            source.source === currentSource && source.id === currentId,
        );
        detailData = target
          ? target
          : await lightweightPreference(searchResult);
      } else {
        detailData = await lightweightPreference(searchResult);
      }

      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      // 优先保留URL参数中的豆瓣ID，如果URL中没有则使用详情数据中的
      setVideoDoubanId(videoDoubanIdRef.current || detailData.douban_id || 0);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex((prev) => (prev === 0 ? prev : 0));
      }

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 🚀 等待播放器模块预加载完成（如果还没完成的话）
      await preloadPlayerPromise;

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  useEffect(() => {
    if (
      loading ||
      !optimizationEnabled ||
      !speedTestReady ||
      speedTestComplete ||
      filteredSources.length === 0
    )
      return;
    fullSpeedTest(filteredSources);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, optimizationEnabled, speedTestReady]);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;
      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          setCurrentEpisodeIndex((prev) =>
            prev === targetIndex ? prev : targetIndex,
          );
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 🚀 优化的换源处理（防连续点击）
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
  ) => {
    try {
      // 防止连续点击换源
      if (isSourceChangingRef.current) {
        console.log('⏸️ 正在换源中，忽略重复点击');
        return;
      }

      // 🚀 设置换源标识，防止useEffect重复处理弹幕
      isSourceChangingRef.current = true;

      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 🚀 立即重置弹幕相关状态，避免残留
      lastDanmuLoadKeyRef.current = '';
      danmuLoadingRef.current = false;

      // 清除弹幕操作定时器
      if (danmuOperationTimeoutRef.current) {
        clearTimeout(danmuOperationTimeoutRef.current);
        danmuOperationTimeoutRef.current = null;
      }
      if (episodeSwitchTimeoutRef.current) {
        clearTimeout(episodeSwitchTimeoutRef.current);
        episodeSwitchTimeoutRef.current = null;
      }

      // 🚀 正确地清空弹幕状态（基于ArtPlayer插件API）
      if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
        const plugin = artPlayerRef.current.plugins.artplayerPluginDanmuku;

        try {
          // 🚀 正确清空弹幕：先reset回收DOM，再load清空队列
          if (typeof plugin.reset === 'function') {
            plugin.reset(); // 立即回收所有正在显示的弹幕DOM
          }

          if (typeof plugin.load === 'function') {
            // 关键：load()不传参数会触发清空逻辑（danmuku === undefined）
            plugin.load();
            console.log('✅ 已完全清空弹幕队列');
          }

          // 然后隐藏弹幕层
          if (typeof plugin.hide === 'function') {
            plugin.hide();
          }

          console.log('🧹 换源时已清空旧弹幕数据');
        } catch (error) {
          console.warn('清空弹幕时出错，但继续换源:', error);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId,
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      const record = await deletePlayRecord(
        currentSourceRef.current,
        currentIdRef.current,
      );

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      // 优先保留URL参数中的豆瓣ID，如果URL中没有则使用详情数据中的
      setVideoDoubanId(videoDoubanIdRef.current || newDetail.douban_id || 0);
      setCurrentSource(newDetail.source);
      setCurrentId(newDetail.id);
      await saveCurrentPlayProgress(newDetail, record);
      setDetail(newDetail);
      // 🚀 换源完成后，优化弹幕加载流程
      setTimeout(async () => {
        isSourceChangingRef.current = false; // 重置换源标识

        if (
          artPlayerRef.current?.plugins?.artplayerPluginDanmuku &&
          externalDanmuEnabledRef.current
        ) {
          console.log('🔄 换源完成，开始优化弹幕加载...');

          // 确保状态完全重置
          lastDanmuLoadKeyRef.current = '';
          danmuLoadingRef.current = false;

          try {
            const startTime = performance.now();
            const danmuData = await loadExternalDanmu();

            if (
              danmuData.length > 0 &&
              artPlayerRef.current?.plugins?.artplayerPluginDanmuku
            ) {
              const plugin =
                artPlayerRef.current.plugins.artplayerPluginDanmuku;

              // 🚀 确保在加载新弹幕前完全清空旧弹幕
              plugin.reset(); // 立即回收所有正在显示的弹幕DOM
              plugin.load(); // 不传参数，完全清空队列
              console.log('🧹 换源后已清空旧弹幕，准备加载新弹幕');

              // 🚀 优化大量弹幕的加载：分批处理，减少阻塞
              if (danmuData.length > 1000) {
                // 先加载前500条，快速显示
                const firstBatch = danmuData.slice(0, 500);
                plugin.load(firstBatch);

                // 剩余弹幕分批异步加载，避免阻塞
                const remainingBatches = [];
                for (let i = 500; i < danmuData.length; i += 300) {
                  remainingBatches.push(danmuData.slice(i, i + 300));
                }

                // 使用requestIdleCallback分批加载剩余弹幕
                remainingBatches.forEach((batch, index) => {
                  setTimeout(
                    () => {
                      if (
                        artPlayerRef.current?.plugins?.artplayerPluginDanmuku
                      ) {
                        // 将批次弹幕追加到现有队列
                        batch.forEach((danmu) => {
                          plugin.emit(danmu).catch(console.warn);
                        });
                      }
                    },
                    (index + 1) * 100,
                  ); // 每100ms加载一批
                });

                console.log(
                  `⚡ 分批加载完成: 首批${firstBatch.length}条 + ${remainingBatches.length}个后续批次`,
                );
              } else {
                // 弹幕数量较少，正常加载
                plugin.load(danmuData);
                console.log(`✅ 换源后弹幕加载完成: ${danmuData.length} 条`);
              }
              const loadTime = performance.now() - startTime;
              console.log(`⏱️ 弹幕加载耗时: ${loadTime.toFixed(2)}ms`);
            } else {
              console.log('📭 换源后没有弹幕数据');
            }
          } catch (error) {
            console.error('❌ 换源后弹幕加载失败:', error);
          }
        }
      }, 1000); // 减少到1秒延迟，加快响应
    } catch (err) {
      // 重置换源标识
      isSourceChangingRef.current = false;
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = async (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      setCurrentEpisodeIndex((prev) =>
        prev === episodeNumber ? prev : episodeNumber,
      );
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      setCurrentEpisodeIndex((prev) => (prev === idx - 1 ? prev : idx - 1));
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      // 🔑 标记通过 SkipController 触发了下一集
      isSkipControllerTriggeredRef.current = true;
      setCurrentEpisodeIndex((prev) => (prev === idx + 1 ? prev : idx + 1));
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100,
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100,
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async (
    detail?: SearchResult,
    record?: PlayRecord,
  ) => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current
    ) {
      return;
    }
    const newDetail = detail ? detail : detailRef.current;
    const player = artPlayerRef.current;
    const recordTime = record?.play_time || 0;
    const currentTime = record?.play_time || player.currentTime || 0;
    const duration = record?.total_time || player.duration || 0;
    if (currentTime < 5 || !duration) {
      return;
    }
    try {
      const currentTotalEpisodes = newDetail.episodes.length || 1;
      const remarksToSave = newDetail.remarks;
      const finalPlayTime = Math.floor(
        recordTime > currentTime ? recordTime : currentTime,
      );
      const finalTotalTime = Math.floor(duration);
      const finalRecord: PlayRecord = {
        title: videoTitleRef.current,
        source_name: newDetail.source_name || '',
        year: newDetail.year,
        cover: newDetail.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: currentTotalEpisodes,
        play_time: finalPlayTime,
        total_time: finalTotalTime,
        save_time: Date.now(),
        search_title: searchTitle,
        remarks: remarksToSave, // 优先使用搜索结果的 remarks，因为详情接口可能没有
        douban_id: videoDoubanIdRef.current || newDetail.douban_id || undefined, // 添加豆瓣ID
      };
      const identity: PlayProgressIdentity = {
        key: generateStorageKey(newDetail.source, newDetail.id),
        episode: finalRecord.index,
        playTime: finalPlayTime,
        totalTime: finalTotalTime,
        totalEpisodes: currentTotalEpisodes,
      };

      if (!shouldQueuePlayProgress(lastQueuedProgressRef.current, identity)) {
        return;
      }

      lastQueuedProgressRef.current = identity;
      lastSaveTimeRef.current = Date.now();
      await progressSaveQueue.enqueue({
        source: newDetail.source,
        id: newDetail.id,
        record: finalRecord,
        identity,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  const saveCurrentPlayProgressRef = useRef(saveCurrentPlayProgress);
  saveCurrentPlayProgressRef.current = saveCurrentPlayProgress;

  useEffect(() => {
    const flushProgress = () => {
      void saveCurrentPlayProgressRef.current();
    };

    const handlePageHide = () => {
      flushProgress();
      releaseWakeLock();
    };

    // 页面可见性变化时保存播放进度和释放 Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 页面重新可见时，如果正在播放则重新请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 添加事件监听器
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态（支持豆瓣/Bangumi等虚拟源）
  useEffect(() => {
    if (!currentSource || !currentId) return;

    // 🚀 性能优化：延迟检查收藏状态，避免首屏阻塞
    const timer = setTimeout(() => {
      (async () => {
        try {
          const favorites = await getAllFavorites();

          // 检查多个可能的收藏key
          const possibleKeys = [
            `${currentSource}+${currentId}`, // 当前真实播放源
            videoDoubanId ? `douban+${videoDoubanId}` : null, // 豆瓣收藏
            videoDoubanId ? `bangumi+${videoDoubanId}` : null, // Bangumi收藏
          ].filter(Boolean);

          // 检查是否任一key已被收藏
          const fav = possibleKeys.some((key) => !!favorites[key as string]);
          setFavorited(fav);
        } catch (err) {
          console.error('检查收藏状态失败:', err);
        }
      })();
    }, 500); // 延迟500ms

    return () => clearTimeout(timer);
  }, [currentSource, currentId, videoDoubanId]);

  // 监听收藏数据更新事件（支持豆瓣/Bangumi等虚拟源）
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        // 检查多个可能的收藏key
        const possibleKeys = [
          generateStorageKey(currentSource, currentId), // 当前真实播放源
          videoDoubanId ? `douban+${videoDoubanId}` : null, // 豆瓣收藏
          videoDoubanId ? `bangumi+${videoDoubanId}` : null, // Bangumi收藏
        ].filter(Boolean);

        // 检查是否任一key已被收藏
        const isFav = possibleKeys.some((key) => !!favorites[key as string]);
        setFavorited(isFav);
      },
    );

    return unsubscribe;
  }, [currentSource, currentId, videoDoubanId]);

  // 自动更新收藏的集数和片源信息（支持豆瓣/Bangumi/短剧等虚拟源）
  useEffect(() => {
    if (!detail || !currentSource || !currentId) return;

    const updateFavoriteData = async () => {
      try {
        const realEpisodes = detail.episodes.length || 1;
        const favorites = await getAllFavorites();

        // 检查多个可能的收藏key
        const possibleKeys = [
          `${currentSource}+${currentId}`, // 当前真实播放源
          videoDoubanId ? `douban+${videoDoubanId}` : null, // 豆瓣收藏
          videoDoubanId ? `bangumi+${videoDoubanId}` : null, // Bangumi收藏
        ].filter(Boolean);

        let favoriteToUpdate = null;
        let favoriteKey = '';

        // 找到已存在的收藏
        for (const key of possibleKeys) {
          if (favorites[key as string]) {
            favoriteToUpdate = favorites[key as string];
            favoriteKey = key as string;
            break;
          }
        }

        if (!favoriteToUpdate) return;

        // 检查是否需要更新（集数不同或缺少片源信息）
        const needsUpdate =
          favoriteToUpdate.total_episodes === 99 ||
          favoriteToUpdate.total_episodes !== realEpisodes ||
          !favoriteToUpdate.source_name ||
          favoriteToUpdate.source_name === '即将上映' ||
          favoriteToUpdate.source_name === '豆瓣' ||
          favoriteToUpdate.source_name === 'Bangumi';

        if (needsUpdate) {
          console.log(`🔄 更新收藏数据: ${favoriteKey}`, {
            旧集数: favoriteToUpdate.total_episodes,
            新集数: realEpisodes,
            旧片源: favoriteToUpdate.source_name,
            新片源: detail.source_name,
          });

          // 提取收藏key中的source和id
          const [favSource, favId] = favoriteKey.split('+');

          // 根据 type_name 推断内容类型
          const inferType = (typeName?: string): string | undefined => {
            if (!typeName) return undefined;
            const lowerType = typeName.toLowerCase();
            if (lowerType.includes('综艺') || lowerType.includes('variety'))
              return 'variety';
            if (lowerType.includes('电影') || lowerType.includes('movie'))
              return 'movie';
            if (
              lowerType.includes('电视剧') ||
              lowerType.includes('剧集') ||
              lowerType.includes('tv') ||
              lowerType.includes('series')
            )
              return 'tv';
            if (
              lowerType.includes('动漫') ||
              lowerType.includes('动画') ||
              lowerType.includes('anime')
            )
              return 'anime';
            if (
              lowerType.includes('纪录片') ||
              lowerType.includes('documentary')
            )
              return 'documentary';
            return undefined;
          };

          // 确定内容类型：优先使用已有的 type，如果没有则推断
          let contentType =
            favoriteToUpdate.type || inferType(detail.type_name);
          // 更新收藏
          await saveFavorite(favSource, favId, {
            ...favoriteToUpdate,
            total_episodes: realEpisodes,
            source_name: detail.source_name || favoriteToUpdate.source_name,
            type: contentType,
            // 如果没有 search_title，尝试使用当前视频标题
            search_title:
              favoriteToUpdate.search_title ||
              videoTitle ||
              favoriteToUpdate.title,
          });

          console.log('✅ 收藏数据更新成功');
        }
      } catch (err) {
        console.error('自动更新收藏数据失败:', err);
      }
    };

    updateFavoriteData();
  }, [
    detail,
    currentSource,
    currentId,
    videoDoubanId,
    searchTitle,
    videoTitle,
  ]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 根据 type_name 推断内容类型
        const inferType = (typeName?: string): string | undefined => {
          if (!typeName) return undefined;
          const lowerType = typeName.toLowerCase();
          if (lowerType.includes('综艺') || lowerType.includes('variety'))
            return 'variety';
          if (lowerType.includes('电影') || lowerType.includes('movie'))
            return 'movie';
          if (
            lowerType.includes('电视剧') ||
            lowerType.includes('剧集') ||
            lowerType.includes('tv') ||
            lowerType.includes('series')
          )
            return 'tv';
          if (
            lowerType.includes('动漫') ||
            lowerType.includes('动画') ||
            lowerType.includes('anime')
          )
            return 'anime';
          if (lowerType.includes('纪录片') || lowerType.includes('documentary'))
            return 'documentary';
          return undefined;
        };
        // 根据 source 或 type_name 确定内容类型
        let contentType = inferType(detailRef.current?.type_name);
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
          type: contentType,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  useEffect(() => {
    const initRunId = ++playerInitRunIdRef.current;
    const isStaleInit = () =>
      isUnmountedRef.current || playerInitRunIdRef.current !== initRunId;

    // 异步初始化播放器，避免SSR问题
    const initPlayer = async () => {
      if (
        isStaleInit() ||
        !Hls ||
        !videoUrl ||
        loading ||
        currentEpisodeIndex === null ||
        !artRef.current
      ) {
        return;
      }

      // 确保选集索引有效
      if (
        !detail ||
        !detail.episodes ||
        currentEpisodeIndex >= detail.episodes.length ||
        currentEpisodeIndex < 0
      ) {
        setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
        return;
      }

      if (!videoUrl) {
        setError('视频地址无效');
        return;
      }

      // 检测移动设备和浏览器类型 - 使用统一的全局检测结果
      const isSafari = /^(?:(?!chrome|android).)*safari/i.test(userAgent);
      const isIOS = isIOSGlobal;
      const isIOS13 = isIOS13Global;
      const isMobile = isMobileGlobal;
      const isWebKit = isSafari || isIOS;
      // Chrome浏览器检测 - 只有真正的Chrome才支持Chromecast
      // 排除各种厂商浏览器，即使它们的UA包含Chrome字样
      const isChrome =
        /Chrome/i.test(userAgent) &&
        !/Edg/i.test(userAgent) && // 排除Edge
        !/OPR/i.test(userAgent) && // 排除Opera
        !/SamsungBrowser/i.test(userAgent) && // 排除三星浏览器
        !/OPPO/i.test(userAgent) && // 排除OPPO浏览器
        !/OppoBrowser/i.test(userAgent) && // 排除OppoBrowser
        !/HeyTapBrowser/i.test(userAgent) && // 排除HeyTapBrowser (OPPO新版浏览器)
        !/OnePlus/i.test(userAgent) && // 排除OnePlus浏览器
        !/Xiaomi/i.test(userAgent) && // 排除小米浏览器
        !/MIUI/i.test(userAgent) && // 排除MIUI浏览器
        !/Huawei/i.test(userAgent) && // 排除华为浏览器
        !/Vivo/i.test(userAgent) && // 排除Vivo浏览器
        !/UCBrowser/i.test(userAgent) && // 排除UC浏览器
        !/QQBrowser/i.test(userAgent) && // 排除QQ浏览器
        !/Baidu/i.test(userAgent) && // 排除百度浏览器
        !/SogouMobileBrowser/i.test(userAgent); // 排除搜狗浏览器

      // 调试信息：输出设备检测结果和投屏策略
      console.log('🔍 设备检测结果:', {
        userAgent,
        isIOS,
        isSafari,
        isMobile,
        isWebKit,
        isChrome,
        AirPlay按钮: isIOS || isSafari ? '✅ 显示' : '❌ 隐藏',
        Chromecast按钮: isChrome && !isIOS ? '✅ 显示' : '❌ 隐藏',
        投屏策略:
          isIOS || isSafari
            ? '🍎 AirPlay (WebKit)'
            : isChrome
              ? '📺 Chromecast (Cast API)'
              : '❌ 不支持投屏',
      });

      // 🚀 优化连续切换：防抖机制 + 资源管理
      if (artPlayerRef.current && !loading) {
        try {
          // 清除之前的切换定时器
          if (sourceSwitchTimeoutRef.current) {
            clearTimeout(sourceSwitchTimeoutRef.current);
            sourceSwitchTimeoutRef.current = null;
          }

          // 如果有正在进行的切换，先取消
          if (switchPromiseRef.current) {
            console.log('⏸️ 取消前一个切换操作，开始新的切换');
            // ArtPlayer没有提供取消机制，但我们可以忽略旧的结果
            switchPromiseRef.current = null;
          }

          // 保存弹幕状态
          if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
            danmuPluginStateRef.current = {
              isHide:
                artPlayerRef.current.plugins.artplayerPluginDanmuku.isHide,
              isStop:
                artPlayerRef.current.plugins.artplayerPluginDanmuku.isStop,
              option:
                artPlayerRef.current.plugins.artplayerPluginDanmuku.option,
            };
          }

          // 🚀 关键修复：区分换源和切换集数
          const isEpisodeChange = isEpisodeChangingRef.current;

          let switchPromise: Promise<any>;
          if (isEpisodeChange) {
            console.log(`🎯 开始切换集数: ${videoUrl} (重置播放时间到0)`);
            // 切换集数时重置播放时间到0
            switchPromise = artPlayerRef.current.switchUrl(videoUrl);
          } else {
            console.log(`🎯 开始切换源: ${videoUrl}`);
            // 换源时保持播放进度
            switchPromise = artPlayerRef.current.switchQuality(videoUrl);
          }

          // 创建切换Promise
          switchPromise = switchPromise
            .then(() => {
              // 只有当前Promise还是活跃的才执行后续操作
              if (switchPromiseRef.current === switchPromise) {
                artPlayerRef.current.title = `${videoTitle} - 第${currentEpisodeIndex + 1}集`;
                artPlayerRef.current.poster = videoCover;
                console.log('✅ 源切换完成');

                // 🔥 重置集数切换标识
                if (isEpisodeChange) {
                  // 🔑 关键修复：切换集数后显式重置播放时间为 0，确保片头自动跳过能触发
                  artPlayerRef.current.currentTime = 0;
                  console.log('🎯 集数切换完成，重置播放时间为 0');
                  isEpisodeChangingRef.current = false;
                }
              }
            })
            .catch((error: any) => {
              if (switchPromiseRef.current === switchPromise) {
                console.warn('⚠️ 源切换失败，将重建播放器:', error);
                // 重置集数切换标识
                if (isEpisodeChange) {
                  isEpisodeChangingRef.current = false;
                }
                throw error; // 让外层catch处理
              }
            });

          switchPromiseRef.current = switchPromise;
          await switchPromise;

          if (isStaleInit()) {
            if (isUnmountedRef.current) {
              stopPlayerMedia();
            }
            return;
          }

          if (artPlayerRef.current?.video) {
            ensureVideoSource(
              artPlayerRef.current.video as HTMLVideoElement,
              videoUrl,
            );
          }

          // 🚀 移除原有的 setTimeout 弹幕加载逻辑，交由 useEffect 统一优化处理

          console.log('使用switch方法成功切换视频');
          return;
        } catch (error) {
          console.warn('Switch方法失败，将重建播放器:', error);
          // 重置集数切换标识
          isEpisodeChangingRef.current = false;
          // 如果switch失败，清理播放器并重新创建
          await cleanupPlayer();
          if (isStaleInit()) {
            return;
          }
        }
      }
      if (artPlayerRef.current) {
        await cleanupPlayer();
        if (isStaleInit()) {
          return;
        }
      }

      // 确保 DOM 容器完全清空，避免多实例冲突
      if (artRef.current) {
        artRef.current.innerHTML = '';
      }

      try {
        // 使用动态导入的 Artplayer
        const Artplayer = (window as any).DynamicArtplayer;
        const artplayerPluginDanmuku = (window as any)
          .DynamicArtplayerPluginDanmuku;

        // 创建新的播放器实例
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        Artplayer.USE_RAF = false;
        Artplayer.FULLSCREEN_WEB_IN_BODY = true;
        // 重新启用5.3.0内存优化功能，但使用false参数避免清空DOM
        Artplayer.REMOVE_SRC_WHEN_DESTROY = true;

        const getDevicePerformance = () => {
          const hardwareConcurrency = navigator.hardwareConcurrency || 2;
          const memory = (performance as any).memory?.jsHeapSizeLimit || 0;

          // 简单性能评分（0-1）
          let score = 0;
          score += Math.min(hardwareConcurrency / 4, 1) * 0.5; // CPU核心数权重
          score += Math.min(memory / (1024 * 1024 * 1024), 1) * 0.3; // 内存权重
          score += (isMobile ? 0.2 : 0.5) * 0.2; // 设备类型权重

          if (score > 0.7) return 'high';
          if (score > 0.4) return 'medium';
          return 'low';
        };

        const devicePerformance = getDevicePerformance();
        console.log(`🎯 设备性能等级: ${devicePerformance}`);
        const defaultDanmakuAntiOverlap =
          devicePerformance === 'high'
            ? true
            : devicePerformance === 'medium'
              ? !isMobile
              : false;

        const getSavedDanmakuBool = (key: string, fallback: boolean) => {
          const saved = localStorage.getItem(key);
          if (saved === null) return fallback;
          return saved === 'true';
        };

        if (isStaleInit() || !artRef.current) {
          return;
        }

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: videoUrl,
          poster: videoCover,
          volume: 0.7,
          isLive: false,
          // iOS设备需要静音才能自动播放，参考ArtPlayer源码处理
          muted: isIOS || isSafari,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: !isMobile, // 桌面端启用截图功能
          setting: true,
          loop: false,
          flip: false,
          playbackRate: true,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: true,
          autoOrientation: true,
          lock: true,
          // AirPlay 仅在支持 WebKit API 的浏览器中启用
          // 主要是 Safari (桌面和移动端) 和 iOS 上的其他浏览器
          airplay: isIOS || isSafari,
          moreVideoAttr: {
            crossOrigin: 'anonymous',
          },
          // HLS 支持配置
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string) {
              trackVideoElement(video);

              if (isUnmountedRef.current) {
                stopVideoElement(video);
                return;
              }

              if (!Hls) {
                console.error('HLS.js 未加载');
                return;
              }

              if (video.hls) {
                try {
                  video.hls.stopLoad();
                  video.hls.detachMedia();
                  video.hls.destroy();
                  video.hls = null;
                } catch (e) {
                  console.warn('清理旧HLS实例时出错:', e);
                }
              }

              // 在函数内部重新检测iOS13+设备
              const localIsIOS13 = isIOS13;

              // 获取用户的缓冲模式配置
              const bufferConfig = getHlsBufferConfig();

              // 🚀 根据 HLS.js 官方源码的最佳实践配置
              const hls = new Hls({
                debug: false,
                enableWorker: true,
                // 参考 HLS.js config.ts：移动设备关闭低延迟模式以节省资源
                lowLatencyMode: !isMobile,

                // 🎯 官方推荐的缓冲策略 - iOS13+ 特别优化
                /* 缓冲长度配置 - 参考 hlsDefaultConfig - 桌面设备应用用户配置 */
                maxBufferLength: isMobile
                  ? localIsIOS13
                    ? 8
                    : isIOS
                      ? 10
                      : 15 // iOS13+: 8s, iOS: 10s, Android: 15s
                  : bufferConfig.maxBufferLength, // 桌面使用用户配置
                backBufferLength: isMobile
                  ? localIsIOS13
                    ? 5
                    : isIOS
                      ? 8
                      : 10 // iOS13+更保守
                  : bufferConfig.backBufferLength, // 桌面使用用户配置

                /* 缓冲大小配置 - 基于官方 maxBufferSize - 桌面设备应用用户配置 */
                maxBufferSize: isMobile
                  ? localIsIOS13
                    ? 20 * 1000 * 1000
                    : isIOS
                      ? 30 * 1000 * 1000
                      : 40 * 1000 * 1000 // iOS13+: 20MB, iOS: 30MB, Android: 40MB
                  : bufferConfig.maxBufferSize, // 桌面使用用户配置

                /* 网络加载优化 - 参考 defaultLoadPolicy */
                maxLoadingDelay: isMobile ? (localIsIOS13 ? 2 : 3) : 4, // iOS13+设备更快超时
                maxBufferHole: isMobile ? (localIsIOS13 ? 0.05 : 0.1) : 0.1, // 减少缓冲洞容忍度

                /* Fragment管理 - 参考官方配置 */
                liveDurationInfinity: false, // 避免无限缓冲 (官方默认false)
                liveBackBufferLength: isMobile ? (localIsIOS13 ? 3 : 5) : null, // 已废弃，保持兼容

                /* 高级优化配置 - 参考 StreamControllerConfig */
                maxMaxBufferLength: isMobile ? (localIsIOS13 ? 60 : 120) : 600, // 最大缓冲长度限制
                maxFragLookUpTolerance: isMobile ? 0.1 : 0.25, // 片段查找容忍度

                /* ABR优化 - 参考 ABRControllerConfig */
                abrEwmaFastLive: isMobile ? 2 : 3, // 移动端更快的码率切换
                abrEwmaSlowLive: isMobile ? 6 : 9,
                abrBandWidthFactor: isMobile ? 0.8 : 0.95, // 移动端更保守的带宽估计

                /* 启动优化 */
                startFragPrefetch: !isMobile, // 移动端关闭预取以节省资源
                testBandwidth: !localIsIOS13, // iOS13+关闭带宽测试以快速启动

                /* Loader配置 - 参考官方 fragLoadPolicy */
                fragLoadPolicy: {
                  default: {
                    maxTimeToFirstByteMs: isMobile ? 6000 : 10000,
                    maxLoadTimeMs: isMobile ? 60000 : 120000,
                    timeoutRetry: {
                      maxNumRetry: isMobile ? 2 : 4,
                      retryDelayMs: 0,
                      maxRetryDelayMs: 0,
                    },
                    errorRetry: {
                      maxNumRetry: isMobile ? 3 : 6,
                      retryDelayMs: 1000,
                      maxRetryDelayMs: isMobile ? 4000 : 8000,
                    },
                  },
                },

                /* Manifest加载策略 - 解决页面切换后重新进入时的网络错误 */
                manifestLoadPolicy: {
                  default: {
                    maxTimeToFirstByteMs: 8000,
                    maxLoadTimeMs: 20000,
                    timeoutRetry: {
                      maxNumRetry: 3,
                      retryDelayMs: 500,
                      maxRetryDelayMs: 2000,
                    },
                    errorRetry: {
                      maxNumRetry: 4,
                      retryDelayMs: 500,
                      maxRetryDelayMs: 3000,
                    },
                  },
                },

                /* Playlist加载策略 */
                playlistLoadPolicy: {
                  default: {
                    maxTimeToFirstByteMs: 8000,
                    maxLoadTimeMs: 20000,
                    timeoutRetry: {
                      maxNumRetry: 3,
                      retryDelayMs: 500,
                      maxRetryDelayMs: 2000,
                    },
                    errorRetry: {
                      maxNumRetry: 4,
                      retryDelayMs: 500,
                      maxRetryDelayMs: 3000,
                    },
                  },
                },

                /* 自定义loader */
                loader: blockAdEnabledRef.current
                  ? CustomHlsJsLoader
                  : Hls.DefaultConfig.loader,
              });

              hls.loadSource(url);
              hls.attachMedia(video);
              video.hls = hls;

              ensureVideoSource(video, url);

              hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                console.error('HLS Error:', event, data);

                // v1.6.15 改进：优化了播放列表末尾空片段/间隙处理，改进了音频TS片段duration处理
                // v1.6.13 增强：处理片段解析错误（针对initPTS修复）
                if (data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
                  console.log('片段解析错误，尝试重新加载...');
                  // 重新开始加载，利用v1.6.13的initPTS修复
                  hls.startLoad();
                  return;
                }

                // v1.6.13 增强：处理时间戳相关错误（直播回搜修复）
                if (
                  data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR &&
                  data.err &&
                  data.err.message &&
                  data.err.message.includes('timestamp')
                ) {
                  console.log('时间戳错误，清理缓冲区并重新加载...');
                  try {
                    // 清理缓冲区后重新开始，利用v1.6.13的时间戳包装修复
                    const currentTime = video.currentTime;
                    hls.trigger(Hls.Events.BUFFER_RESET, undefined);
                    hls.startLoad(currentTime);
                  } catch (e) {
                    console.warn('缓冲区重置失败:', e);
                    hls.startLoad();
                  }
                  return;
                }

                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      // 检查是否是 manifestLoadError，这通常发生在页面切换后重新进入时
                      if (
                        data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
                      ) {
                        // manifestLoadPolicy 已经处理了重试，这里只记录日志
                        // 如果到达这里说明所有重试都失败了
                        console.log(
                          'Manifest加载错误（重试已耗尽），尝试最后一次恢复...',
                        );
                        // 延迟重试，给浏览器时间清理之前的连接
                        setTimeout(() => {
                          if (isUnmountedRef.current || !hls || !hls.media)
                            return; // 如果 HLS 已被销毁则不重试
                          try {
                            // 销毁旧实例并重新创建
                            hls.destroy();
                            video.hls = null;
                            // 触发播放器重新初始化
                            if (artPlayerRef.current) {
                              artPlayerRef.current.switchUrl(url);
                            }
                          } catch (e) {
                            console.warn('最终恢复失败:', e);
                          }
                        }, 1000);
                      } else {
                        console.log('网络错误，尝试恢复...');
                        hls.startLoad();
                      }
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.log('媒体错误，尝试恢复...');
                      hls.recoverMediaError();
                      break;
                    default:
                      console.log('无法恢复的错误');
                      hls.destroy();
                      break;
                  }
                }
              });
            },
          },
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          settings: [
            {
              html: '去广告',
              icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
              tooltip: blockAdEnabled ? '已开启' : '已关闭',
              onClick() {
                const newVal = !blockAdEnabled;
                try {
                  localStorage.setItem('enable_blockad', String(newVal));
                  if (artPlayerRef.current) {
                    if (artPlayerRef.current.video.hls) {
                      const hls = artPlayerRef.current.video.hls;
                      hls.stopLoad();
                      hls.detachMedia();
                      hls.destroy();
                      artPlayerRef.current.video.hls = null;
                    }
                    stopPlayerMedia();
                    artPlayerRef.current.destroy(false);
                    artPlayerRef.current = null;
                  }
                  setBlockAdEnabled(newVal);
                } catch (__) {
                  // ignore
                }
                return newVal ? '当前开启' : '当前关闭';
              },
            },
            {
              name: '外部弹幕',
              html: '外部弹幕',
              icon: '<text x="50%" y="50%" font-size="14" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">外</text>',
              tooltip: externalDanmuEnabled
                ? '外部弹幕已开启'
                : '外部弹幕已关闭',
              switch: externalDanmuEnabled,
              onSwitch: function (item: any) {
                const nextState = !item.switch;

                // 🚀 使用优化后的弹幕操作处理函数
                handleDanmuOperationOptimized(nextState);

                // 更新tooltip显示
                item.tooltip = nextState ? '外部弹幕已开启' : '外部弹幕已关闭';

                return nextState; // 立即返回新状态
              },
            },
            ...(webGPUSupported
              ? [
                  {
                    name: 'Anime4K超分',
                    html: 'Anime4K超分',
                    switch: anime4kEnabledRef.current,
                    onSwitch: async function (item: any) {
                      const newVal = !item.switch;
                      await toggleAnime4K(newVal);
                      return newVal;
                    },
                  },
                  {
                    name: '超分模式',
                    html: '超分模式',
                    tooltip: getAnime4KModeLabel(anime4kModeRef.current),
                    selector: [
                      {
                        html: 'ModeA (快速)',
                        value: 'ModeA',
                        default: anime4kModeRef.current === 'ModeA',
                      },
                      {
                        html: 'ModeB (标准)',
                        value: 'ModeB',
                        default: anime4kModeRef.current === 'ModeB',
                      },
                      {
                        html: 'ModeC (高质)',
                        value: 'ModeC',
                        default: anime4kModeRef.current === 'ModeC',
                      },
                      {
                        html: 'ModeAA (极速)',
                        value: 'ModeAA',
                        default: anime4kModeRef.current === 'ModeAA',
                      },
                      {
                        html: 'ModeBB (平衡)',
                        value: 'ModeBB',
                        default: anime4kModeRef.current === 'ModeBB',
                      },
                      {
                        html: 'ModeCA (优质)',
                        value: 'ModeCA',
                        default: anime4kModeRef.current === 'ModeCA',
                      },
                    ],
                    onSelect: async function (item: any) {
                      await changeAnime4KMode(item.value);
                      return item.html;
                    },
                  },
                  {
                    name: '超分倍数',
                    html: '超分倍数',
                    tooltip: getAnime4KScaleLabel(anime4kScaleRef.current),
                    selector: [
                      {
                        html: '1.0x',
                        value: '1.0',
                        default: anime4kScaleRef.current === 1.0,
                      },
                      {
                        html: '2.0x',
                        value: '2.0',
                        default: anime4kScaleRef.current === 2.0,
                      },
                      {
                        html: '3.0x',
                        value: '3.0',
                        default: anime4kScaleRef.current === 3.0,
                      },
                      {
                        html: '4.0x',
                        value: '4.0',
                        default: anime4kScaleRef.current === 4.0,
                      },
                    ],
                    onSelect: async function (item: any) {
                      await changeAnime4KScale(parseFloat(item.value));
                      return item.html;
                    },
                  },
                ]
              : []),
          ],
          // 控制栏配置
          controls: [
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: function () {
                handleNextEpisode();
              },
            },
          ],
          // 🚀 性能优化的弹幕插件配置 - 保持弹幕数量，优化渲染性能
          plugins: [
            artplayerPluginDanmuku(
              (() => {
                // 🚀 激进性能优化：针对大量弹幕的渲染策略
                const getOptimizedConfig = () => {
                  const savedAntiOverlap = getSavedDanmakuBool(
                    'danmaku_antiOverlap',
                    defaultDanmakuAntiOverlap,
                  );
                  const baseConfig = {
                    danmuku: [], // 初始为空数组，后续通过load方法加载
                    speed: parseFloat(
                      localStorage.getItem('danmaku_speed') || '5',
                    ),
                    opacity: parseFloat(
                      localStorage.getItem('danmaku_opacity') || '0.8',
                    ),
                    fontSize: parseInt(
                      localStorage.getItem('danmaku_fontSize') || '25',
                    ),
                    color: '#FFFFFF',
                    mode: 0 as const,
                    modes: JSON.parse(
                      localStorage.getItem('danmaku_modes') || '[0, 1, 2]',
                    ) as Array<0 | 1 | 2>,
                    margin: JSON.parse(
                      localStorage.getItem('danmaku_margin') || '[10, "75%"]',
                    ) as [number | `${number}%`, number | `${number}%`],
                    visible:
                      localStorage.getItem('danmaku_visible') !== 'false',
                    emitter: false,
                    maxLength: 50,
                    lockTime: 1, // 🎯 进一步减少锁定时间，提升进度跳转响应
                    theme: 'dark' as const,
                    width: 300,

                    // 🎯 激进优化配置 - 保持功能完整性
                    antiOverlap: savedAntiOverlap, // 默认按设备性能设置，允许用户手动覆盖
                    synchronousPlayback: true, // ✅ 必须保持true！确保弹幕与视频播放速度同步
                    heatmap: false, // 关闭热力图，减少DOM计算开销

                    // 🧠 智能过滤器 - 激进性能优化，过滤影响性能的弹幕
                    filter: (danmu: any) => {
                      // 基础验证
                      if (!danmu.text || !danmu.text.trim()) return false;

                      const text = danmu.text.trim();

                      // 🔥 激进长度限制，减少DOM渲染负担
                      if (text.length > 50) return false; // 从100改为50，更激进
                      if (text.length < 2) return false; // 过短弹幕通常无意义

                      // 🔥 激进特殊字符过滤，避免复杂渲染
                      const specialCharCount = (
                        text.match(
                          /[^\u4e00-\u9fa5a-zA-Z0-9\s.,!?；，。！？]/g,
                        ) || []
                      ).length;
                      if (specialCharCount > 5) return false; // 从10改为5，更严格

                      // 🔥 过滤纯数字或纯符号弹幕，减少无意义渲染
                      if (/^\d+$/.test(text)) return false;
                      if (/^[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]+$/.test(text))
                        return false;

                      // 🔥 过滤常见低质量弹幕，提升整体质量
                      const lowQualityPatterns = [
                        /^666+$/,
                        /^好+$/,
                        /^哈+$/,
                        /^啊+$/,
                        /^[!！.。？?]+$/,
                        /^牛+$/,
                        /^强+$/,
                      ];
                      if (
                        lowQualityPatterns.some((pattern) => pattern.test(text))
                      )
                        return false;

                      return true;
                    },

                    // 🚀 优化的弹幕显示前检查（换源时性能优化）
                    beforeVisible: (danmu: any) => {
                      return new Promise<boolean>((resolve) => {
                        // 换源期间快速拒绝弹幕显示，减少处理开销
                        if (isSourceChangingRef.current) {
                          resolve(false);
                          return;
                        }

                        // 🎯 动态弹幕密度控制 - 根据当前屏幕上的弹幕数量决定是否显示
                        const currentVisibleCount = document.querySelectorAll(
                          '.art-danmuku [data-state="emit"]',
                        ).length;
                        const maxConcurrentDanmu =
                          devicePerformance === 'high'
                            ? 60
                            : devicePerformance === 'medium'
                              ? 40
                              : 25;

                        if (currentVisibleCount >= maxConcurrentDanmu) {
                          // 🔥 当弹幕密度过高时，随机丢弃部分弹幕，保持流畅性
                          const dropRate =
                            devicePerformance === 'high'
                              ? 0.1
                              : devicePerformance === 'medium'
                                ? 0.3
                                : 0.5;
                          if (Math.random() < dropRate) {
                            resolve(false); // 丢弃当前弹幕
                            return;
                          }
                        }

                        // 🎯 硬件加速优化
                        if (danmu.$ref && danmu.mode === 0) {
                          danmu.$ref.style.willChange = 'transform';
                          danmu.$ref.style.backfaceVisibility = 'hidden';

                          // 低性能设备额外优化
                          if (devicePerformance === 'low') {
                            danmu.$ref.style.transform = 'translateZ(0)'; // 强制硬件加速
                            danmu.$ref.classList.add('art-danmuku-optimized');
                          }
                        }

                        resolve(true);
                      });
                    },
                  };

                  // 根据设备性能调整核心配置
                  switch (devicePerformance) {
                    case 'high': // 高性能设备 - 完整功能
                      return {
                        ...baseConfig,
                        synchronousPlayback: true, // 保持弹幕与视频播放速度同步
                        useWorker: true, // v5.2.0: 启用Web Worker优化
                      };

                    case 'medium': // 中等性能设备 - 适度优化
                      return {
                        ...baseConfig,
                        synchronousPlayback: true, // 保持同步播放以确保体验一致
                        useWorker: true, // v5.2.0: 中等设备也启用Worker
                      };

                    case 'low': // 低性能设备 - 平衡优化
                      return {
                        ...baseConfig,
                        synchronousPlayback: true, // 保持同步以确保体验，计算量不大
                        useWorker: true, // 开启Worker减少主线程负担
                        maxLength: 30, // v5.2.0优化: 减少弹幕数量是关键优化
                      };
                  }
                };

                const config = getOptimizedConfig();

                // 🎨 为低性能设备添加CSS硬件加速样式
                if (devicePerformance === 'low') {
                  // 创建CSS动画样式（硬件加速）
                  if (!document.getElementById('danmaku-performance-css')) {
                    const style = document.createElement('style');
                    style.id = 'danmaku-performance-css';
                    style.textContent = `
                  /* 🚀 硬件加速的弹幕优化 */
                  .art-danmuku-optimized {
                    will-change: transform !important;
                    backface-visibility: hidden !important;
                    transform: translateZ(0) !important;
                    transition: transform linear !important;
                  }
                `;
                    document.head.appendChild(style);
                    console.log('🎨 已加载CSS硬件加速优化');
                  }
                }

                return config;
              })(),
            ),
            // Chromecast 插件加载策略：
            // 只在 Chrome 浏览器中显示 Chromecast（排除 iOS Chrome）
            // Safari 和 iOS：不显示 Chromecast（用原生 AirPlay）
            // 其他浏览器：不显示 Chromecast（不支持 Cast API）
            ...(isChrome && !isIOS
              ? [
                  artplayerPluginChromecast({
                    onStateChange: (state) => {
                      console.log('Chromecast state changed:', state);
                    },
                    onCastAvailable: (available) => {
                      console.log('Chromecast available:', available);
                    },
                    onCastStart: () => {
                      console.log('Chromecast started');
                    },
                    onError: (error) => {
                      console.error('Chromecast error:', error);
                    },
                  }),
                ]
              : []),
            // 毛玻璃效果控制栏插件 - 现代化悬浮设计
            // CSS已优化：桌面98%宽度，移动端100%，按钮可自动缩小适应
            artplayerPluginLiquidGlass(),
          ],
        });
        trackVideoElement(artPlayerRef.current.video as HTMLVideoElement);

        if (isStaleInit()) {
          stopPlayerMedia(artPlayerRef.current);
          artPlayerRef.current.destroy(false);
          if (artPlayerRef.current) {
            artPlayerRef.current = null;
          }
          return;
        }

        // 监听播放器事件
        artPlayerRef.current.on('ready', async () => {
          if (isUnmountedRef.current) {
            stopPlayerMedia();
            return;
          }

          setError(null);
          setPlayerReady(true); // 标记播放器已就绪

          // 使用ArtPlayer layers API添加分辨率徽章（带渐变和发光效果）
          const video = artPlayerRef.current.video as HTMLVideoElement;

          // 添加分辨率徽章layer
          artPlayerRef.current.layers.add({
            name: 'resolution-badge',
            html: '<div class="resolution-badge"></div>',
            style: {
              position: 'absolute',
              bottom: '60px',
              left: '20px',
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '700',
              color: 'white',
              textShadow: '0 1px 3px rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(10px)',
              pointerEvents: 'none',
              opacity: '1',
              transition: 'opacity 0.3s ease',
              letterSpacing: '0.5px',
            },
          });

          // 自动隐藏徽章的定时器
          let badgeHideTimer: NodeJS.Timeout | null = null;

          const showBadge = () => {
            const badge = artPlayerRef.current?.layers['resolution-badge'];
            if (badge) {
              badge.style.opacity = '1';

              // 清除之前的定时器
              if (badgeHideTimer) {
                clearTimeout(badgeHideTimer);
              }

              // 3秒后自动隐藏徽章
              badgeHideTimer = setTimeout(() => {
                if (badge) {
                  badge.style.opacity = '0';
                }
              }, 3000);
            }
          };

          const updateResolution = () => {
            const player = artPlayerRef.current;
            if (!player || !player.layers) {
              return;
            }

            if (video.videoWidth && video.videoHeight) {
              const width = video.videoWidth;
              const label =
                width >= 3840
                  ? '4K'
                  : width >= 2560
                    ? '2K'
                    : width >= 1920
                      ? '1080P'
                      : width >= 1280
                        ? '720P'
                        : width + 'P';

              // 根据质量设置不同的渐变背景和发光效果
              let gradientStyle = '';
              let boxShadow = '';

              if (width >= 3840) {
                // 4K - 金色/紫色渐变 + 金色发光
                gradientStyle =
                  'linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FF8C00 100%)';
                boxShadow =
                  '0 0 20px rgba(255, 215, 0, 0.6), 0 0 10px rgba(255, 165, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
              } else if (width >= 2560) {
                // 2K - 蓝色/青色渐变 + 蓝色发光
                gradientStyle =
                  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                boxShadow =
                  '0 0 20px rgba(102, 126, 234, 0.6), 0 0 10px rgba(118, 75, 162, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
              } else if (width >= 1920) {
                // 1080P - 绿色/青色渐变 + 绿色发光
                gradientStyle =
                  'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                boxShadow =
                  '0 0 15px rgba(17, 153, 142, 0.5), 0 0 8px rgba(56, 239, 125, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
              } else if (width >= 1280) {
                // 720P - 橙色渐变 + 橙色发光
                gradientStyle =
                  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                boxShadow =
                  '0 0 15px rgba(240, 147, 251, 0.4), 0 0 8px rgba(245, 87, 108, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
              } else {
                // 低质量 - 灰色渐变
                gradientStyle =
                  'linear-gradient(135deg, #606c88 0%, #3f4c6b 100%)';
                boxShadow =
                  '0 0 10px rgba(96, 108, 136, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
              }

              // 更新layer内容和样式
              const badge = player.layers['resolution-badge'];
              if (badge) {
                badge.innerHTML = label;
                badge.style.background = gradientStyle;
                badge.style.boxShadow = boxShadow;
              }

              // 显示徽章并启动自动隐藏定时器
              showBadge();
            }
          };

          // 监听loadedmetadata事件获取分辨率
          video.addEventListener('loadedmetadata', updateResolution);
          if (video.videoWidth && video.videoHeight) {
            updateResolution();
          }

          // 用户交互时重新显示徽章（鼠标移动、点击、键盘操作）
          const userInteractionEvents = [
            'mousemove',
            'click',
            'touchstart',
            'keydown',
          ];
          userInteractionEvents.forEach((eventName) => {
            artPlayerRef.current?.on(eventName, showBadge);
          });

          // iOS设备自动播放优化：如果是静音启动的，在开始播放后恢复音量
          if ((isIOS || isSafari) && artPlayerRef.current.muted) {
            console.log('iOS设备静音自动播放，准备在播放开始后恢复音量');

            const handleFirstPlay = () => {
              setTimeout(() => {
                if (artPlayerRef.current && artPlayerRef.current.muted) {
                  artPlayerRef.current.muted = false;
                  artPlayerRef.current.volume = lastVolumeRef.current || 0.7;
                  console.log(
                    'iOS设备已恢复音量:',
                    artPlayerRef.current.volume,
                  );
                }
              }, 500); // 延迟500ms确保播放稳定

              // 只执行一次
              artPlayerRef.current.off('video:play', handleFirstPlay);
            };

            artPlayerRef.current.on('video:play', handleFirstPlay);
          }

          // 添加弹幕插件按钮选择性隐藏CSS
          const optimizeDanmukuControlsCSS = () => {
            if (document.getElementById('danmuku-controls-optimize')) return;

            const style = document.createElement('style');
            style.id = 'danmuku-controls-optimize';
            style.textContent = `
            /* 隐藏弹幕开关按钮和发射器 */
            .artplayer-plugin-danmuku .apd-toggle {
              display: none !important;
            }

            .artplayer-plugin-danmuku .apd-emitter {
              display: none !important;
            }

            
            /* 弹幕配置面板优化 - 修复全屏模式下点击问题 */
            .artplayer-plugin-danmuku .apd-config {
              position: relative;
            }
            
            .artplayer-plugin-danmuku .apd-config-panel {
              /* 使用绝对定位而不是fixed，让ArtPlayer的动态定位生效 */
              position: absolute !important;
              /* 保持ArtPlayer原版的默认left: 0，让JS动态覆盖 */
              /* 保留z-index确保层级正确 */
              z-index: 2147483647 !important; /* 使用最大z-index确保在全屏模式下也能显示在最顶层 */
              /* 确保面板可以接收点击事件 */
              pointer-events: auto !important;
              /* 避免与插件内层背景叠加导致双层黑底 */
              background: transparent !important;
              backdrop-filter: none !important;
              bottom: 25px !important; /* 显示在按钮上方 */
              left: 50% !important;
              right: auto !important;
              transform: translateX(-50%) !important;
            }
          `;
            document.head.appendChild(style);
          };

          // 应用CSS优化
          optimizeDanmukuControlsCSS();

          // 🎯 优化弹幕交互：改为点击触发，解决hover误触问题
          const setupDanmakuInteraction = () => {
            // 1. 立即注入CSS：强制隐藏面板（覆盖默认hover行为），仅在有.show类时显示
            // 移出setTimeout确保CSS尽早生效，防止初始hover闪烁
            const addInteractionCSS = () => {
              if (document.getElementById('danmaku-interaction-css')) return;
              const style = document.createElement('style');
              style.id = 'danmaku-interaction-css';
              style.textContent = `
                /* 🚫 禁用默认hover行为：默认隐藏面板 */
                .artplayer-plugin-danmuku .apd-config-panel,
                .artplayer-plugin-danmuku .apd-style-panel {
                  display: none !important;
                  opacity: 0 !important;
                  pointer-events: none !important;
                  visibility: hidden !important;
                  transition: opacity 0.2s ease, visibility 0.2s ease;
                }

                /* ✅ 点击激活状态：显示面板 */
                .artplayer-plugin-danmuku .apd-config-panel.show,
                .artplayer-plugin-danmuku .apd-style-panel.show {
                  display: block !important;
                  opacity: 1 !important;
                  pointer-events: auto !important;
                  visibility: visible !important;
                }

                /* 🖱️ 确保按钮可点击 */
                .artplayer-plugin-danmuku .apd-config,
                .artplayer-plugin-danmuku .apd-style {
                  cursor: pointer !important;
                  pointer-events: auto !important;
                }

                /* 确保进度条层级足够高 */
                .art-progress {
                  position: relative;
                  z-index: 10 !important;
                }
              `;
              document.head.appendChild(style);
            };

            addInteractionCSS();

            let isDraggingProgress = false;

            setTimeout(() => {
              const progressControl = document.querySelector(
                '.art-control-progress',
              ) as HTMLElement;
              if (!progressControl) return;

              // 2. 添加点击事件监听
              const configBtn = document.querySelector(
                '.artplayer-plugin-danmuku .apd-config',
              );
              const styleBtn = document.querySelector(
                '.artplayer-plugin-danmuku .apd-style',
              );
              const configPanel = document.querySelector(
                '.artplayer-plugin-danmuku .apd-config-panel',
              );
              const stylePanel = document.querySelector(
                '.artplayer-plugin-danmuku .apd-style-panel',
              );

              const togglePanel = (
                btn: Element | null,
                panel: Element | null,
                otherPanel: Element | null,
              ) => {
                if (!btn || !panel) return;

                btn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  e.preventDefault();

                  // 关闭其他面板
                  if (otherPanel) otherPanel.classList.remove('show');

                  // 切换当前面板
                  const isShown = panel.classList.contains('show');
                  if (isShown) {
                    panel.classList.remove('show');
                  } else {
                    panel.classList.add('show');
                  }
                });
              };

              togglePanel(configBtn, configPanel, stylePanel);
              togglePanel(styleBtn, stylePanel, configPanel);

              // 3. 点击外部关闭面板
              document.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                // 如果点击的不是弹幕插件区域，则关闭所有面板
                if (!target.closest('.artplayer-plugin-danmuku')) {
                  configPanel?.classList.remove('show');
                  stylePanel?.classList.remove('show');
                }
              });

              // 4. 保持原有的拖拽优化逻辑
              const handleProgressMouseDown = (event: MouseEvent) => {
                if (event.button === 0) {
                  isDraggingProgress = true;
                  const artplayer = document.querySelector(
                    '.artplayer',
                  ) as HTMLElement;
                  if (artplayer)
                    artplayer.setAttribute('data-dragging', 'true');
                }
              };

              const handleDocumentMouseMove = () => {
                if (isDraggingProgress) {
                  // 拖拽时关闭面板
                  configPanel?.classList.remove('show');
                  stylePanel?.classList.remove('show');
                }
              };

              const handleDocumentMouseUp = () => {
                if (isDraggingProgress) {
                  isDraggingProgress = false;
                  const artplayer = document.querySelector(
                    '.artplayer',
                  ) as HTMLElement;
                  if (artplayer) artplayer.removeAttribute('data-dragging');
                }
              };

              progressControl.addEventListener(
                'mousedown',
                handleProgressMouseDown,
              );
              document.addEventListener('mousemove', handleDocumentMouseMove);
              document.addEventListener('mouseup', handleDocumentMouseUp);
            }, 1500); // 等待插件加载
          };

          // 启用新的交互逻辑
          setupDanmakuInteraction();

          // 播放器就绪后，加载外部弹幕数据
          console.log('播放器已就绪，开始加载外部弹幕');
          setTimeout(async () => {
            try {
              const externalDanmu = await loadExternalDanmu(); // 这里会检查开关状态
              console.log('外部弹幕加载结果:', externalDanmu);

              if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
                if (externalDanmu.length > 0) {
                  console.log(
                    '向播放器插件加载弹幕数据:',
                    externalDanmu.length,
                    '条',
                  );
                  artPlayerRef.current.plugins.artplayerPluginDanmuku.load(
                    externalDanmu,
                  );
                  artPlayerRef.current.notice.show = `已加载 ${externalDanmu.length} 条弹幕`;
                } else {
                  console.log('没有弹幕数据可加载');
                  artPlayerRef.current.notice.show = '暂无弹幕数据';
                }
              } else {
                console.error('弹幕插件未找到');
              }
            } catch (error) {
              console.error('加载外部弹幕失败:', error);
            }
          }, 1000); // 延迟1秒确保插件完全初始化

          // 监听弹幕插件的显示/隐藏事件，自动保存状态到localStorage
          artPlayerRef.current.on('artplayerPluginDanmuku:show', () => {
            localStorage.setItem('danmaku_visible', 'true');
            console.log('弹幕显示状态已保存');
          });

          artPlayerRef.current.on('artplayerPluginDanmuku:hide', () => {
            localStorage.setItem('danmaku_visible', 'false');
            console.log('弹幕隐藏状态已保存');
          });

          // 监听弹幕插件的配置变更事件，自动保存所有设置到localStorage
          artPlayerRef.current.on(
            'artplayerPluginDanmuku:config',
            (option: any) => {
              try {
                // 保存所有弹幕配置到localStorage
                if (typeof option.fontSize !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_fontSize',
                    option.fontSize.toString(),
                  );
                }
                if (typeof option.opacity !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_opacity',
                    option.opacity.toString(),
                  );
                }
                if (typeof option.speed !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_speed',
                    option.speed.toString(),
                  );
                }
                if (typeof option.margin !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_margin',
                    JSON.stringify(option.margin),
                  );
                }
                if (typeof option.modes !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_modes',
                    JSON.stringify(option.modes),
                  );
                }
                if (typeof option.antiOverlap !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_antiOverlap',
                    option.antiOverlap.toString(),
                  );
                }
                if (typeof option.visible !== 'undefined') {
                  localStorage.setItem(
                    'danmaku_visible',
                    option.visible.toString(),
                  );
                }
                console.log('弹幕配置已自动保存:', option);
              } catch (error) {
                console.error('保存弹幕配置失败:', error);
              }
            },
          );

          // 监听播放进度跳转，优化弹幕重置（减少闪烁）
          artPlayerRef.current.on('seek', () => {
            if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
              // 清除之前的重置计时器
              if (seekResetTimeoutRef.current) {
                clearTimeout(seekResetTimeoutRef.current);
              }

              // 增加延迟并只在非拖拽状态下重置，减少快进时的闪烁
              seekResetTimeoutRef.current = setTimeout(() => {
                if (
                  !isDraggingProgressRef.current &&
                  artPlayerRef.current?.plugins?.artplayerPluginDanmuku &&
                  !artPlayerRef.current.seeking
                ) {
                  artPlayerRef.current.plugins.artplayerPluginDanmuku.reset();
                  console.log('进度跳转，弹幕已重置');
                }
              }, 500); // 增加到500ms延迟，减少频繁重置导致的闪烁
            }
          });

          // 监听拖拽状态 - v5.2.0优化: 在拖拽期间暂停弹幕更新以减少闪烁
          artPlayerRef.current.on('video:seeking', () => {
            isDraggingProgressRef.current = true;
            // v5.2.0新增: 拖拽时隐藏弹幕，减少CPU占用和闪烁
            // 只有在外部弹幕开启且当前显示时才隐藏
            if (
              artPlayerRef.current?.plugins?.artplayerPluginDanmuku &&
              externalDanmuEnabledRef.current &&
              !artPlayerRef.current.plugins.artplayerPluginDanmuku.isHide
            ) {
              artPlayerRef.current.plugins.artplayerPluginDanmuku.hide();
            }
          });

          artPlayerRef.current.on('video:seeked', () => {
            isDraggingProgressRef.current = false;
            // v5.2.0优化: 拖拽结束后根据外部弹幕开关状态决定是否恢复弹幕显示
            if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
              // 只有在外部弹幕开启时才恢复显示
              if (externalDanmuEnabledRef.current) {
                artPlayerRef.current.plugins.artplayerPluginDanmuku.show(); // 先恢复显示
                setTimeout(() => {
                  // 延迟重置以确保播放状态稳定
                  if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
                    artPlayerRef.current.plugins.artplayerPluginDanmuku.reset();
                    console.log('拖拽结束，弹幕已重置');
                  }
                }, 100);
              } else {
                // 外部弹幕关闭时，确保保持隐藏状态
                artPlayerRef.current.plugins.artplayerPluginDanmuku.hide();
                console.log('拖拽结束，外部弹幕已关闭，保持隐藏状态');
              }
            }
          });

          // 监听播放器窗口尺寸变化，触发弹幕重置（双重保障）
          artPlayerRef.current.on('resize', () => {
            // 清除之前的重置计时器
            if (resizeResetTimeoutRef.current) {
              clearTimeout(resizeResetTimeoutRef.current);
            }

            // 延迟重置弹幕，避免连续触发（全屏切换优化）
            resizeResetTimeoutRef.current = setTimeout(() => {
              if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
                artPlayerRef.current.plugins.artplayerPluginDanmuku.reset();
                console.log('窗口尺寸变化，弹幕已重置（防抖优化）');
              }
            }, 300); // 300ms防抖，减少全屏切换时的卡顿
          });

          // 播放器就绪后，如果正在播放则请求 Wake Lock
          if (artPlayerRef.current && !artPlayerRef.current.paused) {
            requestWakeLock();
          }
        });

        // 监听播放状态变化，控制 Wake Lock
        artPlayerRef.current.on('play', () => {
          requestWakeLock();
        });

        artPlayerRef.current.on('pause', () => {
          releaseWakeLock();
          // 🔥 关键修复：暂停时也检查是否在片尾，避免保存错误的进度
          const currentTime = artPlayerRef.current?.currentTime || 0;
          const duration = artPlayerRef.current?.duration || 0;
          const remainingTime = duration - currentTime;
          const isNearEnd = duration > 0 && remainingTime < 180; // 最后3分钟
          if (
            !isNearEnd &&
            !isSourceChangingRef.current &&
            !isEpisodeChangingRef.current
          ) {
            void saveCurrentPlayProgressRef.current();
          }
        });

        artPlayerRef.current.on('video:ended', () => {
          releaseWakeLock();
        });

        // 如果播放器初始化时已经在播放状态，则请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }

        artPlayerRef.current.on('video:volumechange', () => {
          lastVolumeRef.current = artPlayerRef.current.volume;
        });
        artPlayerRef.current.on('video:ratechange', () => {
          lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
        });

        // 监听视频可播放事件，这时恢复播放进度更可靠
        artPlayerRef.current.on('video:canplay', async () => {
          // 🔥 重置 video:ended 处理标志，因为这是新视频
          videoEndedHandledRef.current = false;
          try {
            const allRecords =
              getCachedPlayRecords() || (await getAllPlayRecords());
            const key = generateStorageKey(
              currentSourceRef.current,
              currentIdRef.current,
            );
            const record = allRecords[key];
            const recodeTime =
              record && record.index - 1 == currentEpisodeIndexRef.current
                ? record.play_time
                : 0;
            const recodeDuration =
              record && record.index - 1 == currentEpisodeIndexRef.current
                ? record.total_time
                : 0;
            const duration =
              artPlayerRef.current.duration || recodeDuration || 0;
            const currentTime = artPlayerRef.current.currentTime || 0;
            let playerTime = currentTime > 1 ? currentTime : recodeTime;
            if (duration && playerTime >= duration - 2) {
              playerTime = Math.max(0, duration - 5);
            }
            if (Math.abs(playerTime - artPlayerRef.current.currentTime) > 1) {
              artPlayerRef.current.currentTime = playerTime;
            }
            console.log(
              '成功恢复播放进度到:',
              currentTime,
              playerTime,
              record?.index,
              currentEpisodeIndexRef.current,
            );
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }

          // iOS设备自动播放回退机制：如果自动播放失败，尝试用户交互触发播放
          if ((isIOS || isSafari) && artPlayerRef.current.paused) {
            console.log('iOS设备检测到视频未自动播放，准备交互触发机制');

            const tryAutoPlay = async () => {
              try {
                // 多重尝试策略
                let playAttempts = 0;
                const maxAttempts = 3;

                const attemptPlay = async (): Promise<boolean> => {
                  playAttempts++;
                  console.log(`iOS自动播放尝试 ${playAttempts}/${maxAttempts}`);

                  try {
                    await artPlayerRef.current.play();
                    console.log('iOS设备自动播放成功');
                    return true;
                  } catch (playError: any) {
                    console.log(
                      `播放尝试 ${playAttempts} 失败:`,
                      playError.name,
                    );

                    // 根据错误类型采用不同策略
                    if (playError.name === 'NotAllowedError') {
                      // 用户交互需求错误 - 最常见
                      if (playAttempts < maxAttempts) {
                        // 尝试降低音量再播放
                        artPlayerRef.current.volume = 0.1;
                        await new Promise((resolve) =>
                          setTimeout(resolve, 200),
                        );
                        return attemptPlay();
                      }
                      return false;
                    } else if (playError.name === 'AbortError') {
                      // 播放被中断 - 等待后重试
                      if (playAttempts < maxAttempts) {
                        await new Promise((resolve) =>
                          setTimeout(resolve, 500),
                        );
                        return attemptPlay();
                      }
                      return false;
                    }
                    return false;
                  }
                };

                const success = await attemptPlay();

                if (!success) {
                  console.log(
                    'iOS设备需要用户交互才能播放，这是正常的浏览器行为',
                  );
                  // 显示友好的播放提示
                  if (artPlayerRef.current) {
                    artPlayerRef.current.notice.show = '轻触播放按钮开始观看';

                    // 添加一次性点击监听器用于首次播放
                    let hasHandledFirstInteraction = false;
                    const handleFirstUserInteraction = async () => {
                      if (hasHandledFirstInteraction) return;
                      hasHandledFirstInteraction = true;

                      try {
                        await artPlayerRef.current.play();
                        // 首次成功播放后恢复正常音量
                        setTimeout(() => {
                          if (
                            artPlayerRef.current &&
                            !artPlayerRef.current.muted
                          ) {
                            artPlayerRef.current.volume =
                              lastVolumeRef.current || 0.7;
                          }
                        }, 1000);
                      } catch (error) {
                        console.warn('用户交互播放失败:', error);
                      }

                      // 移除监听器
                      artPlayerRef.current?.off(
                        'video:play',
                        handleFirstUserInteraction,
                      );
                      document.removeEventListener(
                        'click',
                        handleFirstUserInteraction,
                      );
                    };

                    // 监听播放事件和点击事件
                    artPlayerRef.current.on(
                      'video:play',
                      handleFirstUserInteraction,
                    );
                    document.addEventListener(
                      'click',
                      handleFirstUserInteraction,
                    );
                  }
                }
              } catch (error) {
                console.warn('自动播放回退机制执行失败:', error);
              }
            };

            // 延迟尝试，避免与进度恢复冲突
            setTimeout(tryAutoPlay, 200);
          }

          setTimeout(() => {
            if (
              Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) >
              0.01
            ) {
              artPlayerRef.current.volume = lastVolumeRef.current;
            }
            if (
              Math.abs(
                artPlayerRef.current.playbackRate - lastPlaybackRateRef.current,
              ) > 0.01 &&
              isWebKit
            ) {
              artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
            }
            artPlayerRef.current.notice.show = '';
          }, 0);

          // 隐藏换源加载状态
          setIsVideoLoading(false);

          // 🔥 重置集数切换标识（播放器成功创建后）
          if (isEpisodeChangingRef.current) {
            isEpisodeChangingRef.current = false;
            console.log('🎯 播放器创建完成，重置集数切换标识');
          }
        });

        // 监听播放器错误
        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器错误:', err);

          // 详细错误信息记录
          if (err.target && err.target.error) {
            console.error(
              '详细播放器错误:',
              err.target.error.code,
              err.target.error.message,
            );
          } else if (err.detail && err.detail.error) {
            console.error('详细播放器错误 (err.detail):', err.detail.error);
          }

          if (artPlayerRef.current.currentTime > 0) {
            console.warn('播放器在播放过程中发生错误，但已暂停处理。');
            return;
          }
        });

        // 监听视频播放结束事件，自动播放下一集
        artPlayerRef.current.on('video:ended', () => {
          const idx = currentEpisodeIndexRef.current;

          // 🔥 关键修复：首先检查这个 video:ended 事件是否已经被处理过
          if (videoEndedHandledRef.current) {
            return;
          }

          // 🔑 检查是否已经通过 SkipController 触发了下一集，避免重复触发
          if (isSkipControllerTriggeredRef.current) {
            videoEndedHandledRef.current = true;
            // 🔥 关键修复：延迟重置标志，等待新集数开始加载
            setTimeout(() => {
              isSkipControllerTriggeredRef.current = false;
            }, 2000);
            return;
          }

          const d = detailRef.current;
          if (d && d.episodes && idx < d.episodes.length - 1) {
            videoEndedHandledRef.current = true;
            setTimeout(() => {
              setCurrentEpisodeIndex((prev) =>
                prev === idx + 1 ? prev : idx + 1,
              );
            }, 1000);
          }
        });

        // 合并的timeupdate监听器 - 处理跳过片头片尾和保存进度
        artPlayerRef.current.on('video:timeupdate', () => {
          const currentTime = artPlayerRef.current.currentTime || 0;
          const duration = artPlayerRef.current.duration || 0;
          // 更新 SkipController 所需的时间信息
          setCurrentPlayTime(currentTime);
          setVideoDuration(duration);
          // 保存播放进度逻辑 - 优化保存间隔以减少网络开销
          const saveNow = Date.now();
          const interval = PLAY_PROGRESS_SAVE_INTERVAL_MS;
          // 🔥 关键修复：如果当前播放位置接近视频结尾（最后3分钟），不保存进度
          // 这是为了避免自动跳过片尾时保存了片尾位置的进度，导致"继续观看"从错误位置开始
          const remainingTime = duration - currentTime;
          const isNearEnd = duration > 0 && remainingTime < 180; // 最后3分钟

          if (saveNow - lastSaveTimeRef.current > interval && !isNearEnd) {
            void saveCurrentPlayProgressRef.current();
            lastSaveTimeRef.current = saveNow;
          }
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            videoUrl,
          );
        }
      } catch (err) {
        console.error('创建播放器失败:', err);
        // 重置集数切换标识
        isEpisodeChangingRef.current = false;
        setError('播放器初始化失败');
      }
    }; // 结束 initPlayer 函数

    // 动态导入 ArtPlayer 并初始化
    const loadAndInit = async () => {
      try {
        if (isStaleInit()) {
          return;
        }

        // 🚀 优先使用已预加载的模块，如果没有则重新导入
        let Artplayer = (window as any).DynamicArtplayer;
        let artplayerPluginDanmuku = (window as any)
          .DynamicArtplayerPluginDanmuku;

        if (!Artplayer || !artplayerPluginDanmuku) {
          console.log('⏳ 播放器模块未预加载，正在导入...');
          const [{ default: ArtplayerModule }, { default: DanmukuModule }] =
            await Promise.all([
              import(/* webpackPreload: false */ 'artplayer'),
              import(/* webpackPreload: false */ 'artplayer-plugin-danmuku'),
            ]);

          Artplayer = ArtplayerModule;
          artplayerPluginDanmuku = DanmukuModule;

          // 将导入的模块设置为全局变量供 initPlayer 使用
          (window as any).DynamicArtplayer = Artplayer;
          (window as any).DynamicArtplayerPluginDanmuku =
            artplayerPluginDanmuku;
        } else {
          console.log('✅ 使用已预加载的播放器模块');
        }
        if (isStaleInit()) {
          return;
        }
        await initPlayer();
      } catch (error) {
        if (isStaleInit()) {
          return;
        }
        console.error('动态导入 ArtPlayer 失败:', error);
        setError('播放器加载失败');
      }
    };

    loadAndInit();

    return () => {
      if (isUnmountedRef.current) {
        stopPlayerMedia();
      }
    };
  }, [Hls, videoUrl, loading, blockAdEnabled]);

  // 当组件卸载时清理定时器、Wake Lock 和播放器资源
  useEffect(() => {
    return () => {
      // 标记组件已卸载，终止正在进行的异步操作（如测速）
      isUnmountedRef.current = true;

      void saveCurrentPlayProgressRef.current();

      // 1. 同步清理所有定时器 (确保在组件销毁瞬间停止)
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
        saveIntervalRef.current = null;
      }

      const timeoutRefs = [
        seekResetTimeoutRef,
        resizeResetTimeoutRef,
        sourceSwitchTimeoutRef,
        danmuOperationTimeoutRef,
        episodeSwitchTimeoutRef,
      ];

      timeoutRefs.forEach((ref) => {
        if (ref.current) {
          clearTimeout(ref.current);
          ref.current = null;
        }
      });

      // 2. 重置关键状态引用
      isSourceChangingRef.current = false;
      switchPromiseRef.current = null;
      pendingSwitchRef.current = null;
      danmuLoadingRef.current = false;

      // 3. 释放 Wake Lock
      releaseWakeLock();

      // 🚀 关键修复：在组件卸载时同步清理 HLS 实例
      // 必须在 cleanupPlayer 之前同步执行，避免异步导致的网络请求中断问题
      if (artPlayerRef.current?.video?.hls) {
        try {
          const hls = artPlayerRef.current.video.hls;
          hls.stopLoad();
          hls.detachMedia();
          hls.destroy();
          artPlayerRef.current.video.hls = null;
          console.log('组件卸载: HLS实例已同步销毁');
        } catch (e) {
          console.warn('组件卸载时清理HLS出错:', e);
        }
      }
      // 销毁播放器实例
      cleanupPlayer();
    };
  }, []);

  // 返回顶部功能相关 - 🚀 性能优化: 移除 RAF 无限循环
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollTop = document.body.scrollTop || 0;
          setShowBackToTop(scrollTop > 300);
          ticking = false;
        });
        ticking = true;
      }
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (_error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  const currentEpisodeTitle = detail?.episodes_titles?.[currentEpisodeIndex];
  const isAnime = Boolean(
    detail?.type_name &&
    (detail.type_name.toLowerCase().includes('动漫') ||
      detail.type_name.toLowerCase().includes('动画') ||
      detail.type_name.toLowerCase().includes('anime')),
  );

  const handleOpenNetdisk = () => {
    if (!netdiskResults && !netdiskLoading && videoTitle) {
      handleNetDiskSearch(videoTitle);
    }
    setShowNetdiskModal(true);
  };

  const handleResetNetdiskState = () => {
    setNetdiskResults(null);
    setNetdiskError(null);
  };

  const handleCelebrityClose = () => {
    setSelectedCelebrityName(null);
    setCelebrityWorks([]);
  };

  const handleDownloadEpisodes = async (episodeIndexes: number[]) => {
    if (!detail?.episodes || detail.episodes.length === 0) {
      // 单集视频，直接下载当前
      const currentUrl = videoUrl;
      if (!currentUrl) {
        alert('无法获取视频地址');
        return;
      }
      if (!currentUrl.includes('.m3u8')) {
        alert('仅支持M3U8格式视频下载');
        return;
      }
      try {
        await createTask(currentUrl, videoTitle || '视频', 'TS');
      } catch (error) {
        console.error('创建下载任务失败:', error);
        alert('创建下载任务失败: ' + (error as Error).message);
      }
      return;
    }

    // 批量下载多集
    for (const episodeIndex of episodeIndexes) {
      try {
        const episodeUrl = detail.episodes[episodeIndex];
        if (!episodeUrl) continue;

        // 检查是否是M3U8
        if (!episodeUrl.includes('.m3u8')) {
          console.warn(`第${episodeIndex + 1}集不是M3U8格式，跳过`);
          continue;
        }

        const episodeName = `第${episodeIndex + 1}集`;
        const downloadTitle = `${videoTitle || '视频'}_${episodeName}`;
        await createTask(episodeUrl, downloadTitle, 'TS');
      } catch (error) {
        console.error(`创建第${episodeIndex + 1}集下载任务失败:`, error);
      }
    }
  };

  if (loading) {
    return (
      <LoadingScreen
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
      />
    );
  }

  if (error) {
    return <PlayErrorState message={error} videoTitle={videoTitle} />;
  }

  return (
    <>
      <PageLayout activePath='/play'>
        <div className='flex flex-col gap-3 py-4 px-5 lg:px-12 2xl:px-20'>
          <PlayHeader
            title={videoTitle}
            totalEpisodes={totalEpisodes}
            currentEpisodeIndex={currentEpisodeIndex}
            currentEpisodeTitle={currentEpisodeTitle}
          />

          <div className='space-y-2'>
            <PlayToolbar
              netdiskLoading={netdiskLoading}
              netdiskTotal={netdiskTotal}
              onOpenNetdisk={handleOpenNetdisk}
              downloadEnabled={downloadEnabled}
              onDownloadClick={() => setShowDownloadEpisodeSelector(true)}
              onDownloadPanelClick={() => setShowDownloadPanel(true)}
              onRetest={() => fullSpeedTest(filteredSources)}
              retestDisabled={isRetestDisabled}
              isSpeedTestRunning={isSpeedTestRunning}
              isEpisodeSelectorCollapsed={isEpisodeSelectorCollapsed}
              onToggleEpisodeSelector={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
            />

            <PlayPlayerPanel
              artRef={artRef}
              isEpisodeSelectorCollapsed={isEpisodeSelectorCollapsed}
              currentSource={currentSource}
              currentId={currentId}
              detailTitle={detail?.title}
              totalEpisodes={totalEpisodes}
              episodesTitles={detail?.episodes_titles || []}
              currentEpisodeIndex={currentEpisodeIndex}
              onEpisodeChange={handleEpisodeChange}
              onSourceChange={handleSourceChange}
              searchTitle={searchTitle}
              videoTitle={videoTitle}
              availableSources={filteredSources}
              sourceSearchLoading={sourceSearchLoading}
              sourceSearchError={sourceSearchError}
              precomputedVideoInfo={precomputedVideoInfo}
              speedTestResetKey={speedTestResetKey}
              speedTestEnabled={speedTestReady}
              isVideoLoading={isVideoLoading}
              videoLoadingStage={videoLoadingStage}
              isSkipSettingOpen={isSkipSettingOpen}
              onSkipSettingChange={setIsSkipSettingOpen}
              artPlayerRef={artPlayerRef}
              currentPlayTime={currentPlayTime}
              videoDuration={videoDuration}
              onNextEpisode={handleNextEpisode}
            />
          </div>

          <PlayDetailsSection
            detail={detail}
            videoTitle={videoTitle}
            videoYear={videoYear}
            videoDoubanId={videoDoubanId}
            movieDetails={movieDetails}
            bangumiDetails={bangumiDetails}
            loadingMovieDetails={loadingMovieDetails}
            loadingBangumiDetails={loadingBangumiDetails}
            favorited={favorited}
            onToggleFavorite={handleToggleFavorite}
            movieComments={movieComments}
            loadingComments={loadingComments}
            commentsError={commentsError}
            selectedCelebrityName={selectedCelebrityName}
            celebrityWorks={celebrityWorks}
            loadingCelebrityWorks={loadingCelebrityWorks}
            onCelebrityClick={handleCelebrityClick}
            onCelebrityClose={handleCelebrityClose}
            videoCover={videoCover}
          />
        </div>

        {/* 返回顶部悬浮按钮 - 使用独立组件优化性能 */}
        <BackToTopButton show={showBackToTop} onClick={scrollToTop} />
      </PageLayout>

      <PlayNetdiskModal
        open={showNetdiskModal}
        videoTitle={videoTitle}
        isAnime={isAnime}
        netdiskLoading={netdiskLoading}
        netdiskResults={netdiskResults}
        netdiskError={netdiskError}
        netdiskTotal={netdiskTotal}
        netdiskResourceType={netdiskResourceType}
        acgTriggerSearch={acgTriggerSearch}
        onClose={() => setShowNetdiskModal(false)}
        onSearchNetdisk={handleNetDiskSearch}
        onResetNetdiskState={handleResetNetdiskState}
        onResourceTypeChange={setNetdiskResourceType}
        onToggleAcgTrigger={() => setAcgTriggerSearch((prev) => !prev)}
      />
      {/* 下载选集面板 */}
      <DownloadEpisodeSelector
        isOpen={showDownloadEpisodeSelector}
        onClose={() => setShowDownloadEpisodeSelector(false)}
        totalEpisodes={detail?.episodes?.length || 1}
        episodesTitles={detail?.episodes_titles || []}
        videoTitle={videoTitle || '视频'}
        currentEpisodeIndex={currentEpisodeIndex}
        onDownload={handleDownloadEpisodes}
      />
    </>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
