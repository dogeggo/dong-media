/* eslint-disable no-console */

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  Calendar,
  Heart,
  KeyRound,
  LogOut,
  PlayCircle,
  Settings,
  Shield,
  Tv,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  getAllFavorites,
  getAllPlayRecords,
  type PlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  applyTheme,
  getSavedTheme,
  THEME_PRESETS,
  type ThemePreset,
} from '@/lib/theme-config';
import type { Favorite } from '@/lib/types';
import {
  checkWatchingUpdates,
  getDetailedWatchingUpdates,
  subscribeToWatchingUpdatesEvent,
  type WatchingUpdate,
} from '@/lib/watching-updates';

import VideoCard from './VideoCard';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

const SETTINGS_RESET_FLAG_KEY = 'settingsResetDone';

interface UserMenuProps {
  initialOpen?: boolean;
}

export const UserMenu: React.FC<UserMenuProps> = ({ initialOpen = false }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isWatchingUpdatesOpen, setIsWatchingUpdatesOpen] = useState(false);
  const [isContinueWatchingOpen, setIsContinueWatchingOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>(() => {
    // 🔧 优化：直接从 RUNTIME_CONFIG 读取初始值，避免默认值导致的多次渲染
    if (typeof window !== 'undefined') {
      return (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
    }
    return 'localstorage';
  });
  const [mounted, setMounted] = useState(false);
  const [watchingUpdates, setWatchingUpdates] = useState<WatchingUpdate | null>(
    null,
  );
  const [favorites, setFavorites] = useState<(Favorite & { key: string })[]>(
    [],
  );
  const [hasUnreadUpdates, setHasUnreadUpdates] = useState(false);

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (
      isSettingsOpen ||
      isChangePasswordOpen ||
      isWatchingUpdatesOpen ||
      isContinueWatchingOpen ||
      isFavoritesOpen
    ) {
      const body = document.body;
      const html = document.documentElement;

      // 保存原始样式
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;

      // 只设置 overflow 来阻止滚动
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';

      return () => {
        // 恢复所有原始样式
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [
    isSettingsOpen,
    isChangePasswordOpen,
    isWatchingUpdatesOpen,
    isContinueWatchingOpen,
    isFavoritesOpen,
  ]);

  // 设置相关状态
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [fluidSearch, setFluidSearch] = useState(true);
  const [liveDirectConnect, setLiveDirectConnect] = useState(false);
  const [playerBufferMode, setPlayerBufferMode] = useState<
    'standard' | 'enhanced' | 'max'
  >('enhanced');
  const [continueWatchingMinProgress, setContinueWatchingMinProgress] =
    useState(5);
  const [continueWatchingMaxProgress, setContinueWatchingMaxProgress] =
    useState(100);
  const [enableContinueWatchingFilter, setEnableContinueWatchingFilter] =
    useState(false);
  // 跳过片头片尾相关设置
  const [enableAutoSkip, setEnableAutoSkip] = useState(false);
  const [enableAutoNextEpisode, setEnableAutoNextEpisode] = useState(true);

  // 清空继续观看确认设置（默认关闭，需要的用户可以开启）
  const [requireClearConfirmation, setRequireClearConfirmation] =
    useState(true);

  // 下载相关设置
  const [downloadFormat, setDownloadFormat] = useState<'TS' | 'MP4'>('TS');
  const [currentTheme, setCurrentTheme] = useState<ThemePreset>('emerald');

  // 播放缓冲模式选项
  const bufferModeOptions = [
    {
      value: 'standard' as const,
      label: '默认模式',
      description: '标准缓冲设置，适合网络稳定的环境',
      icon: '🎯',
      color: 'green',
    },
    {
      value: 'enhanced' as const,
      label: '增强模式',
      description: '1.5倍缓冲，适合偶尔卡顿的网络环境',
      icon: '⚡',
      color: 'blue',
    },
    {
      value: 'max' as const,
      label: '强力模式',
      description: '3倍大缓冲，起播稍慢但播放更流畅',
      icon: '🚀',
      color: 'purple',
    },
  ];

  // 修改密码相关状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const playRecordsQueryEnabled =
    (isOpen || isContinueWatchingOpen) &&
    !!authInfo?.username &&
    storageType !== 'localstorage';

  const { data: allPlayRecords = {} } = useQuery({
    queryKey: ['playRecords'],
    queryFn: () => getAllPlayRecords(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: playRecordsQueryEnabled,
  });

  const playRecords = useMemo<(PlayRecord & { key: string })[]>(() => {
    if (!playRecordsQueryEnabled) return [];

    const recordsArray = Object.entries(allPlayRecords).map(
      ([key, record]) => ({
        ...record,
        key,
      }),
    );

    const validPlayRecords = recordsArray.filter((record) => {
      const progress =
        record.total_time === 0
          ? 0
          : (record.play_time / record.total_time) * 100;

      // 播放时间必须超过2分钟
      if (record.play_time < 120) return false;

      if (!enableContinueWatchingFilter) return true;

      return (
        progress >= continueWatchingMinProgress &&
        progress <= continueWatchingMaxProgress
      );
    });

    const sortedRecords = validPlayRecords.sort(
      (a, b) => b.save_time - a.save_time,
    );

    return sortedRecords.slice(0, 12);
  }, [
    allPlayRecords,
    playRecordsQueryEnabled,
    enableContinueWatchingFilter,
    continueWatchingMinProgress,
    continueWatchingMaxProgress,
  ]);

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 获取认证信息
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = getAuthInfoFromBrowserCookie();
      setAuthInfo(auth);
    }
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch',
      );
      if (savedAggregateSearch !== null) {
        setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }

      const savedFluidSearch = localStorage.getItem('fluidSearch');
      const defaultFluidSearch =
        (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
      if (savedFluidSearch !== null) {
        setFluidSearch(JSON.parse(savedFluidSearch));
      } else if (defaultFluidSearch !== undefined) {
        setFluidSearch(defaultFluidSearch);
      }

      const savedLiveDirectConnect = localStorage.getItem('liveDirectConnect');
      if (savedLiveDirectConnect !== null) {
        setLiveDirectConnect(JSON.parse(savedLiveDirectConnect));
      }

      // 读取播放缓冲模式
      const savedBufferMode = localStorage.getItem('playerBufferMode');
      if (
        savedBufferMode === 'standard' ||
        savedBufferMode === 'enhanced' ||
        savedBufferMode === 'max'
      ) {
        setPlayerBufferMode(savedBufferMode);
      } else {
        // 如果没有保存的值，设置默认值为 enhanced
        setPlayerBufferMode('enhanced');
      }

      const savedContinueWatchingMinProgress = localStorage.getItem(
        'continueWatchingMinProgress',
      );
      if (savedContinueWatchingMinProgress !== null) {
        setContinueWatchingMinProgress(
          parseInt(savedContinueWatchingMinProgress),
        );
      }

      const savedContinueWatchingMaxProgress = localStorage.getItem(
        'continueWatchingMaxProgress',
      );
      if (savedContinueWatchingMaxProgress !== null) {
        setContinueWatchingMaxProgress(
          parseInt(savedContinueWatchingMaxProgress),
        );
      }

      const savedEnableContinueWatchingFilter = localStorage.getItem(
        'enableContinueWatchingFilter',
      );
      if (savedEnableContinueWatchingFilter !== null) {
        setEnableContinueWatchingFilter(
          JSON.parse(savedEnableContinueWatchingFilter),
        );
      }

      // 读取跳过片头片尾设置（默认开启）
      const savedEnableAutoSkip = localStorage.getItem('enableAutoSkip');
      if (savedEnableAutoSkip !== null) {
        setEnableAutoSkip(JSON.parse(savedEnableAutoSkip));
      }

      const savedEnableAutoNextEpisode = localStorage.getItem(
        'enableAutoNextEpisode',
      );
      if (savedEnableAutoNextEpisode !== null) {
        setEnableAutoNextEpisode(JSON.parse(savedEnableAutoNextEpisode));
      }

      // 读取清空继续观看确认设置（默认关闭）
      const savedRequireClearConfirmation = localStorage.getItem(
        'requireClearConfirmation',
      );
      if (savedRequireClearConfirmation !== null) {
        setRequireClearConfirmation(JSON.parse(savedRequireClearConfirmation));
      }

      // 读取下载格式设置
      const savedDownloadFormat = localStorage.getItem('downloadFormat');
      if (savedDownloadFormat === 'TS' || savedDownloadFormat === 'MP4') {
        setDownloadFormat(savedDownloadFormat);
      }

      // 读取主题设置
      const savedTheme = getSavedTheme();
      if (savedTheme) {
        setCurrentTheme(savedTheme);
      }
    }
  }, []);

  // 获取观看更新信息
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      authInfo?.username &&
      storageType !== 'localstorage'
    ) {
      const updateWatchingUpdates = () => {
        const updates = getDetailedWatchingUpdates();

        // 如果缓存过期或不存在，触发后台更新检查
        if (updates === null) {
          console.log('缓存已过期或不存在，触发后台更新检查...');
          setTimeout(() => {
            checkWatchingUpdates().catch((err) =>
              console.error('UserMenu 触发更新检查失败:', err),
            );
          }, 1000);
        }

        setWatchingUpdates(updates);

        // 检测是否有新更新（只检查新剧集更新，不包括继续观看）
        if (updates && (updates.updatedCount || 0) > 0) {
          const lastViewed = parseInt(
            localStorage.getItem('watchingUpdatesLastViewed') || '0',
          );
          const currentTime = Date.now();

          // 如果从未查看过，或者距离上次查看超过1分钟，认为有新更新
          const hasNewUpdates =
            lastViewed === 0 || currentTime - lastViewed > 60000;
          setHasUnreadUpdates(hasNewUpdates);
        } else {
          setHasUnreadUpdates(false);
        }
      };

      // 🚀 优化：移除页面初始化时的强制检查
      // 只在首页的 ContinueWatching 组件中检查更新
      // UserMenu 只负责显示缓存的更新状态
      console.log('UserMenu: 从缓存加载 watching-updates 数据');
      updateWatchingUpdates();

      // 订阅更新事件
      const unsubscribe = subscribeToWatchingUpdatesEvent(() => {
        console.log('收到 watching-updates 事件，更新数据...');
        updateWatchingUpdates();
      });
      return unsubscribe;
    }
  }, [authInfo, storageType]);

  useEffect(() => {
    if (!playRecordsQueryEnabled) return;

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        queryClient.setQueryData(['playRecords'], newRecords);
      },
    );

    return unsubscribe;
  }, [playRecordsQueryEnabled, queryClient]);

  // 加载收藏数据
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      authInfo?.username &&
      storageType !== 'localstorage'
    ) {
      // 🚀 性能优化：延迟加载收藏数据，避免阻塞页面渲染
      const timer = setTimeout(() => {
        const loadFavorites = async () => {
          try {
            const favoritesData = await getAllFavorites();
            const favoritesArray = Object.entries(favoritesData).map(
              ([key, favorite]) => ({
                ...(favorite as Favorite),
                key,
              }),
            );
            // 按保存时间降序排列
            const sortedFavorites = favoritesArray.sort(
              (a, b) => b.save_time - a.save_time,
            );
            setFavorites(sortedFavorites);
          } catch (error) {
            console.error('加载收藏失败:', error);
          }
        };

        loadFavorites();
      }, 500); // 延迟500ms执行

      // 监听收藏更新事件
      const unsubscribe = subscribeToDataUpdates(
        'favoritesUpdated',
        (favoritesData: Record<string, Favorite>) => {
          console.log('UserMenu: 收藏更新，更新列表');
          const favoritesArray = Object.entries(favoritesData).map(
            ([key, favorite]) => ({
              ...(favorite as Favorite),
              key,
            }),
          );
          // 按保存时间降序排列
          const sortedFavorites = favoritesArray.sort(
            (a, b) => b.save_time - a.save_time,
          );
          setFavorites(sortedFavorites);
        },
      );

      return () => {
        clearTimeout(timer);
        unsubscribe();
      };
    }
  }, [authInfo, storageType]);

  const handleMenuClick = async () => {
    const willOpen = !isOpen;
    setIsOpen(willOpen);

    // 如果是打开菜单，立即检查更新（不受缓存限制）
    if (willOpen && authInfo?.username && storageType !== 'localstorage') {
      console.log('打开菜单，从缓存读取更新状态...');
      try {
        // 🚀 优化：只读取缓存，不主动触发更新检查
        // 更新检查只在首页进行
        const updates = getDetailedWatchingUpdates();
        setWatchingUpdates(updates);

        // 重新计算未读状态
        if (updates && (updates.updatedCount || 0) > 0) {
          const lastViewed = parseInt(
            localStorage.getItem('watchingUpdatesLastViewed') || '0',
          );
          const currentTime = Date.now();
          const hasNewUpdates =
            lastViewed === 0 || currentTime - lastViewed > 60000;
          setHasUnreadUpdates(hasNewUpdates);
        } else {
          setHasUnreadUpdates(false);
        }

        console.log('菜单打开时的缓存读取完成');
      } catch (error) {
        console.error('菜单打开时检查更新失败:', error);
      }
    }
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    router.push('/admin');
  };

  const handlePlayStats = () => {
    setIsOpen(false);
    router.push('/play-stats');
  };

  const handleTVBoxConfig = () => {
    setIsOpen(false);
    router.push('/tvbox');
  };

  const handleReleaseCalendar = () => {
    setIsOpen(false);
    router.push('/release-calendar');
  };

  const handleWatchingUpdates = () => {
    setIsOpen(false);
    setIsWatchingUpdatesOpen(true);
    // 标记为已读
    setHasUnreadUpdates(false);
    const currentTime = Date.now();
    localStorage.setItem('watchingUpdatesLastViewed', currentTime.toString());
  };

  const handleCloseWatchingUpdates = () => {
    setIsWatchingUpdatesOpen(false);
  };

  const handleContinueWatching = () => {
    setIsOpen(false);
    setIsContinueWatchingOpen(true);
  };

  const handleCloseContinueWatching = () => {
    setIsContinueWatchingOpen(false);
  };

  const handleFavorites = () => {
    setIsOpen(false);
    setIsFavoritesOpen(true);
  };

  const handleCloseFavorites = () => {
    setIsFavoritesOpen(false);
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 检查播放记录是否有新集数更新
  const getNewEpisodesCount = (
    record: PlayRecord & { key: string },
  ): number => {
    if (!watchingUpdates || !watchingUpdates.updatedSeries) return 0;

    const { source, id } = parseKey(record.key);

    // 在watchingUpdates中查找匹配的剧集
    const matchedSeries = watchingUpdates.updatedSeries.find(
      (series) =>
        series.sourceKey === source &&
        series.videoId === id &&
        series.hasNewEpisode,
    );

    return matchedSeries ? matchedSeries.newEpisodes || 0 : 0;
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 验证密码
    if (!newPassword) {
      setPasswordError('新密码不得为空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密码失败');
        return;
      }

      // 修改成功，关闭弹窗并登出
      setIsChangePasswordOpen(false);
      await handleLogout();
    } catch (_error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 设置相关的处理函数
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handleFluidSearchToggle = (value: boolean) => {
    setFluidSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fluidSearch', JSON.stringify(value));
    }
  };

  const handleLiveDirectConnectToggle = (value: boolean) => {
    setLiveDirectConnect(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('liveDirectConnect', JSON.stringify(value));
    }
  };

  const handleBufferModeChange = (value: 'standard' | 'enhanced' | 'max') => {
    setPlayerBufferMode(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('playerBufferMode', value);
    }
  };

  const handleContinueWatchingMinProgressChange = (value: number) => {
    setContinueWatchingMinProgress(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('continueWatchingMinProgress', value.toString());
    }
  };

  const handleContinueWatchingMaxProgressChange = (value: number) => {
    setContinueWatchingMaxProgress(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('continueWatchingMaxProgress', value.toString());
    }
  };

  const handleEnableContinueWatchingFilterToggle = (value: boolean) => {
    setEnableContinueWatchingFilter(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'enableContinueWatchingFilter',
        JSON.stringify(value),
      );
    }
  };

  const handleEnableAutoSkipToggle = (value: boolean) => {
    setEnableAutoSkip(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableAutoSkip', JSON.stringify(value));
      // 🔑 通知 SkipController localStorage 已更新
      window.dispatchEvent(new Event('localStorageChanged'));
    }
  };

  const handleEnableAutoNextEpisodeToggle = (value: boolean) => {
    setEnableAutoNextEpisode(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableAutoNextEpisode', JSON.stringify(value));
      // 🔑 通知 SkipController localStorage 已更新
      window.dispatchEvent(new Event('localStorageChanged'));
    }
  };

  const handleRequireClearConfirmationToggle = (value: boolean) => {
    setRequireClearConfirmation(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('requireClearConfirmation', JSON.stringify(value));
    }
  };

  const handleDownloadFormatChange = (value: 'TS' | 'MP4') => {
    setDownloadFormat(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadFormat', value);
    }
  };

  const handleThemeChange = (theme: ThemePreset) => {
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  const handleResetSettings = useCallback(() => {
    const defaultFluidSearch =
      (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setFluidSearch(defaultFluidSearch);
    setLiveDirectConnect(false);
    setContinueWatchingMinProgress(5);
    setContinueWatchingMaxProgress(100);
    setEnableContinueWatchingFilter(false);
    setEnableAutoSkip(false);
    setEnableAutoNextEpisode(true);
    setPlayerBufferMode('enhanced');
    setDownloadFormat('TS');
    setRequireClearConfirmation(true);
    setCurrentTheme('emerald');
    applyTheme('emerald');

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('fluidSearch', JSON.stringify(defaultFluidSearch));
      localStorage.setItem('liveDirectConnect', JSON.stringify(false));
      localStorage.setItem('continueWatchingMinProgress', '5');
      localStorage.setItem('continueWatchingMaxProgress', '100');
      localStorage.setItem(
        'enableContinueWatchingFilter',
        JSON.stringify(false),
      );
      localStorage.setItem('enableAutoSkip', JSON.stringify(false));
      localStorage.setItem('enableAutoNextEpisode', JSON.stringify(true));
      localStorage.setItem('requireClearConfirmation', JSON.stringify(true));
      localStorage.setItem('playerBufferMode', 'enhanced');
      localStorage.setItem('downloadFormat', 'TS');
      localStorage.setItem(SETTINGS_RESET_FLAG_KEY, 'true');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const hasResetSettings = localStorage.getItem(SETTINGS_RESET_FLAG_KEY);
    if (!hasResetSettings) {
      handleResetSettings();
    }
  }, [handleResetSettings]);

  // 检查是否显示管理面板按钮
  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';

  // 检查是否显示修改密码按钮
  const showChangePassword =
    authInfo?.role !== 'owner' && storageType !== 'localstorage';

  // 检查是否显示播放统计按钮（所有登录用户，且非localstorage存储）
  const showPlayStats = authInfo?.username && storageType !== 'localstorage';

  // 检查是否显示更新提醒按钮（登录用户且非localstorage存储就显示）
  const showWatchingUpdates =
    authInfo?.username && storageType !== 'localstorage';

  // 检查是否有实际更新（用于显示红点）- 只检查新剧集更新
  const hasActualUpdates =
    watchingUpdates && (watchingUpdates.updatedCount || 0) > 0;

  // 计算更新数量（只统计新剧集更新）
  const totalUpdates = watchingUpdates?.updatedCount || 0;

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '';
    }
  };

  // 菜单面板内容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜单无需模糊 */}
      <div
        className='fixed inset-0 bg-transparent z-1000'
        onClick={handleCloseMenu}
      />

      {/* 菜单面板 */}
      <div className='fixed top-14 right-4 w-56 bg-primary-50/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl rounded-xl shadow-xl z-1001 border border-primary-200/50 dark:border-white/10 overflow-hidden select-none'>
        {/* 用户信息区域 */}
        <div className='px-3 py-2.5 border-b border-primary-200/50 dark:border-white/[0.06] bg-primary-50/50 dark:bg-white/[0.03]'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                当前用户
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  (authInfo?.role || 'user') === 'owner'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                    : (authInfo?.role || 'user') === 'admin'
                      ? 'bg-primary-100 text-orange-800 dark:bg-primary-900/30 dark:text-orange-300'
                      : 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300'
                }`}
              >
                {getRoleText(authInfo?.role || 'user')}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='font-semibold text-gray-900 dark:text-gray-100 text-sm truncate'>
                {authInfo?.username || 'default'}
              </div>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                数据存储：
                {storageType === 'localstorage' ? '本地' : storageType}
              </div>
            </div>
          </div>
        </div>

        {/* 菜单项 */}
        <div className='py-1'>
          {/* 设置按钮 */}
          <button
            onClick={handleSettings}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <Settings className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>设置</span>
          </button>

          {/* 更新提醒按钮 */}
          {showWatchingUpdates && (
            <button
              onClick={handleWatchingUpdates}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm relative'
            >
              <Bell className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>更新提醒</span>
              {hasUnreadUpdates && totalUpdates > 0 && (
                <div className='ml-auto flex items-center gap-1'>
                  <span className='inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full'>
                    {totalUpdates > 99 ? '99+' : totalUpdates}
                  </span>
                </div>
              )}
            </button>
          )}

          {/* 继续观看按钮 */}
          {showWatchingUpdates && (
            <button
              onClick={handleContinueWatching}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm relative'
            >
              <PlayCircle className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>继续观看</span>
              {playRecords.length > 0 && (
                <span className='ml-auto text-xs text-gray-400'>
                  {playRecords.length}
                </span>
              )}
            </button>
          )}

          {/* 我的收藏按钮 */}
          {showWatchingUpdates && (
            <button
              onClick={handleFavorites}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm relative'
            >
              <Heart className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>我的收藏</span>
              {favorites.length > 0 && (
                <span className='ml-auto text-xs text-gray-400'>
                  {favorites.length}
                </span>
              )}
            </button>
          )}

          {/* 管理面板按钮 */}
          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <Shield className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>管理面板</span>
            </button>
          )}

          {/* 播放统计按钮 */}
          {showPlayStats && (
            <button
              onClick={handlePlayStats}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <BarChart3 className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>
                {authInfo?.role === 'owner' || authInfo?.role === 'admin'
                  ? '播放统计'
                  : '个人统计'}
              </span>
            </button>
          )}

          {/* 上映日程按钮 */}
          <button
            onClick={handleReleaseCalendar}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <Calendar className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>上映日程</span>
          </button>

          {/* TVBox配置按钮 */}
          <button
            onClick={handleTVBoxConfig}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <Tv className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>TVBox 配置</span>
          </button>

          {/* 修改密码按钮 */}
          {showChangePassword && (
            <button
              onClick={handleChangePassword}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <KeyRound className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>修改密码</span>
            </button>
          )}

          {/* 分割线 */}
          <div className='my-1 border-t border-primary-200/50 dark:border-white/[0.06]'></div>

          {/* 登出按钮 */}
          <button
            onClick={handleLogout}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <LogOut className='w-4 h-4' />
            <span className='font-medium'>登出</span>
          </button>
          {/* 分割线 */}
          <div className='my-1 border-t border-primary-200/50 dark:border-white/[0.06]'></div>

          {/* 版本信息 */}
          <a
            href='https://github.com/SzeMeng76/LunaTV'
            target='_blank'
            rel='noopener noreferrer'
            className='w-full px-3 py-2 text-center flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-primary-100/50 dark:hover:bg-white/[0.03] transition-colors text-xs'
          >
            <div className='flex items-center gap-1'>
              <span className='font-mono'>Github Repo</span>
            </div>
          </a>
        </div>
      </div>
    </>
  );

  // 设置面板内容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/40 backdrop-blur-sm z-1000'
        onClick={handleCloseSettings}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 设置面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-primary-50/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl rounded-2xl shadow-2xl z-1001 flex flex-col border border-primary-200/50 dark:border-white/10'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='flex-1 p-6 overflow-y-auto'
          data-panel-content
          style={{
            touchAction: 'pan-y', // 只允许垂直滚动
            overscrollBehavior: 'contain', // 防止滚动冒泡
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地设置
              </h3>
              <button
                onClick={handleResetSettings}
                className='px-2 py-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-500/20 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
                title='重置为默认设置'
              >
                恢复默认
              </button>
            </div>
            <button
              onClick={handleCloseSettings}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 设置项 */}
          <div className='space-y-6'>
            {/* 分割线 */}
            <div className='border-t border-primary-200/50 dark:border-white/[0.06]'></div>

            {/* 主题颜色设置 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  主题颜色
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  选择您喜欢的界面主题色
                </p>
              </div>
              <div className='grid grid-cols-5 gap-2'>
                {Object.entries(THEME_PRESETS).map(([key, preset]) => {
                  const isSelected = currentTheme === key;
                  return (
                    <button
                      key={key}
                      onClick={() => handleThemeChange(key as ThemePreset)}
                      className={`relative group flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all duration-200 ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-transparent hover:bg-primary-100/50 dark:hover:bg-white/5'
                      }`}
                    >
                      <div
                        className='w-8 h-8 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                        style={{
                          backgroundColor: preset.colors['--color-primary-500'],
                        }}
                      />
                      <span
                        className={`text-xs font-medium ${
                          isSelected
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {preset.name.split(' ')[0]}
                      </span>
                      {isSelected && (
                        <div className='absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-primary-500 ring-2 ring-white dark:ring-gray-900' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 分割线 */}
            <div className='border-t border-primary-200/50 dark:border-white/[0.06]'></div>

            {/* 默认聚合搜索结果 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  默认聚合搜索结果
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  搜索时默认按标题和年份聚合显示结果
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={defaultAggregateSearch}
                    onChange={(e) => handleAggregateToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 优选和测速 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  优选和测速
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  如出现播放器劫持问题可关闭
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={enableOptimization}
                    onChange={(e) => handleOptimizationToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 流式搜索 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  流式搜索输出
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  启用搜索结果实时流式输出，关闭后使用传统一次性搜索
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={fluidSearch}
                    onChange={(e) => handleFluidSearchToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 直播视频浏览器直连 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  IPTV 视频浏览器直连
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  开启 IPTV 视频浏览器直连时，需要自备 Allow CORS 插件
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={liveDirectConnect}
                    onChange={(e) =>
                      handleLiveDirectConnectToggle(e.target.checked)
                    }
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 分割线 */}
            <div className='border-t border-primary-200/50 dark:border-white/[0.06]'></div>

            {/* 播放缓冲优化 - 卡片式选择器 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  播放缓冲优化
                </h4>
                <p className='text-xs text-gray-400 dark:text-gray-500 mt-1'>
                  根据网络环境选择合适的缓冲模式，减少播放卡顿
                </p>
              </div>

              {/* 模式选择卡片 */}
              <div className='space-y-2'>
                {bufferModeOptions.map((option) => {
                  const isSelected = playerBufferMode === option.value;
                  const colorClasses = {
                    green: {
                      selected:
                        'border-transparent bg-linear-to-r from-primary-50 to-emerald-50 dark:from-primary-900/20 dark:to-emerald-900/20 ring-2 ring-primary-400/60 dark:ring-primary-500/50 shadow-[0_0_15px_-3px_rgba(34,197,94,0.4)] dark:shadow-[0_0_15px_-3px_rgba(34,197,94,0.3)]',
                      icon: 'bg-linear-to-br from-primary-100 to-emerald-100 dark:from-primary-800/50 dark:to-emerald-800/50',
                      check: 'text-primary-500',
                      label: 'text-primary-700 dark:text-primary-300',
                    },
                    blue: {
                      selected:
                        'border-transparent bg-linear-to-r from-primary-50 to-cyan-50 dark:from-primary-900/20 dark:to-cyan-900/20 ring-2 ring-primary-400/60 dark:ring-primary-500/50 shadow-[0_0_15px_-3px] shadow-primary-500/40 dark:shadow-primary-500/30',
                      icon: 'bg-linear-to-br from-primary-100 to-cyan-100 dark:from-primary-800/50 dark:to-cyan-800/50',
                      check: 'text-primary-500',
                      label: 'text-primary-700 dark:text-primary-300',
                    },
                    purple: {
                      selected:
                        'border-transparent bg-linear-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 ring-2 ring-purple-400/60 dark:ring-purple-500/50 shadow-[0_0_15px_-3px_rgba(168,85,247,0.4)] dark:shadow-[0_0_15px_-3px_rgba(168,85,247,0.3)]',
                      icon: 'bg-linear-to-br from-purple-100 to-pink-100 dark:from-purple-800/50 dark:to-pink-800/50',
                      check: 'text-purple-500',
                      label: 'text-purple-700 dark:text-purple-300',
                    },
                  } as const;
                  const colors =
                    colorClasses[option.color as keyof typeof colorClasses];

                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => handleBufferModeChange(option.value)}
                      className={`w-full p-3 rounded-xl border-2 transition-all duration-300 text-left flex items-center gap-3 ${
                        isSelected
                          ? colors.selected
                          : 'border-primary-200/50 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/15 hover:shadow-sm bg-white dark:bg-white/[0.03]'
                      }`}
                    >
                      {/* 图标 */}
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all duration-300 ${
                          isSelected
                            ? colors.icon
                            : 'bg-gray-100 dark:bg-white/[0.06]'
                        }`}
                      >
                        {option.icon}
                      </div>

                      {/* 文字内容 */}
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span
                            className={`font-medium transition-colors duration-300 ${
                              isSelected
                                ? colors.label
                                : 'text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            {option.label}
                          </span>
                        </div>
                        <p className='text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1'>
                          {option.description}
                        </p>
                      </div>

                      {/* 选中标记 */}
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${
                          isSelected
                            ? `${colors.check} scale-100`
                            : 'text-transparent scale-75'
                        }`}
                      >
                        <svg
                          className='w-5 h-5'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                        >
                          <path
                            fillRule='evenodd'
                            d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                            clipRule='evenodd'
                          />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 分割线 */}
            <div className='border-t border-primary-200/50 dark:border-white/[0.06]'></div>

            {/* 跳过片头片尾设置 */}
            <div className='space-y-4'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  跳过片头片尾设置
                </h4>
                <p className='text-xs text-gray-400 dark:text-gray-500 mt-1'>
                  控制播放器默认的片头片尾跳过行为
                </p>
              </div>

              {/* 自动跳过开关 */}
              <div className='flex items-center justify-between'>
                <div>
                  <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    启用自动跳过
                  </h5>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    开启后将自动跳过片头片尾，关闭则显示手动跳过按钮
                  </p>
                </div>
                <label className='flex items-center cursor-pointer'>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={enableAutoSkip}
                      onChange={(e) =>
                        handleEnableAutoSkipToggle(e.target.checked)
                      }
                    />
                    <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                    <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                  </div>
                </label>
              </div>

              {/* 自动播放下一集开关 */}
              <div className='flex items-center justify-between'>
                <div>
                  <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    片尾自动播放下一集
                  </h5>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    开启后片尾结束时自动跳转到下一集
                  </p>
                </div>
                <label className='flex items-center cursor-pointer'>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={enableAutoNextEpisode}
                      onChange={(e) =>
                        handleEnableAutoNextEpisodeToggle(e.target.checked)
                      }
                    />
                    <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                    <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                  </div>
                </label>
              </div>

              {/* 清空继续观看确认开关 */}
              <div className='flex items-center justify-between'>
                <div>
                  <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    清空记录确认提示
                  </h5>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    开启后点击清空按钮时会弹出确认对话框，防止误操作
                  </p>
                </div>
                <label className='flex items-center cursor-pointer'>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={requireClearConfirmation}
                      onChange={(e) =>
                        handleRequireClearConfirmationToggle(e.target.checked)
                      }
                    />
                    <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                    <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                  </div>
                </label>
              </div>

              {/* 提示信息 */}
              <div className='text-xs text-gray-500 dark:text-gray-400 bg-primary-50 dark:bg-primary-500/10 p-3 rounded-lg border border-primary-200 dark:border-primary-500/20'>
                💡
                这些设置会作为新视频的默认配置。对于已配置的视频，请在播放页面的"跳过设置"中单独调整。
              </div>
            </div>

            {/* 分割线 */}
            <div className='border-t border-primary-200/50 dark:border-white/[0.06]'></div>

            {/* 继续观看筛选设置 */}
            <div className='space-y-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    继续观看进度筛选
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    是否启用"继续观看"的播放进度筛选功能
                  </p>
                </div>
                <label className='flex items-center cursor-pointer'>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={enableContinueWatchingFilter}
                      onChange={(e) =>
                        handleEnableContinueWatchingFilterToggle(
                          e.target.checked,
                        )
                      }
                    />
                    <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-500 transition-colors dark:bg-gray-700'></div>
                    <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                  </div>
                </label>
              </div>

              {/* 进度范围设置 - 仅在启用筛选时显示 */}
              {enableContinueWatchingFilter && (
                <>
                  <div>
                    <h5 className='text-sm font-medium text-gray-600 dark:text-gray-400 mb-3'>
                      进度范围设置
                    </h5>
                  </div>

                  <div className='grid grid-cols-2 gap-4'>
                    {/* 最小进度设置 */}
                    <div>
                      <label className='block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2'>
                        最小进度 (%)
                      </label>
                      <input
                        type='number'
                        min='0'
                        max='100'
                        className='w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100'
                        value={continueWatchingMinProgress}
                        onChange={(e) => {
                          const value = Math.max(
                            0,
                            Math.min(100, parseInt(e.target.value) || 0),
                          );
                          handleContinueWatchingMinProgressChange(value);
                        }}
                      />
                    </div>

                    {/* 最大进度设置 */}
                    <div>
                      <label className='block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2'>
                        最大进度 (%)
                      </label>
                      <input
                        type='number'
                        min='0'
                        max='100'
                        className='w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100'
                        value={continueWatchingMaxProgress}
                        onChange={(e) => {
                          const value = Math.max(
                            0,
                            Math.min(100, parseInt(e.target.value) || 100),
                          );
                          handleContinueWatchingMaxProgressChange(value);
                        }}
                      />
                    </div>
                  </div>

                  {/* 当前范围提示 */}
                  <div className='text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/[0.03] p-3 rounded-lg'>
                    当前设置：显示播放进度在 {continueWatchingMinProgress}% -{' '}
                    {continueWatchingMaxProgress}% 之间的内容
                  </div>
                </>
              )}

              {/* 关闭筛选时的提示 */}
              {!enableContinueWatchingFilter && (
                <div className='text-xs text-gray-500 dark:text-gray-400 bg-orange-50 dark:bg-orange-500/10 p-3 rounded-lg border border-orange-200 dark:border-orange-500/20'>
                  筛选已关闭：将显示所有播放时间超过2分钟的内容
                </div>
              )}
            </div>

            {/* 分割线 */}
            <div className='border-t border-primary-200/50 dark:border-white/[0.06]'></div>

            {/* 下载格式设置 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  下载格式
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  选择视频下载时的默认格式
                </p>
              </div>

              {/* 格式选择 */}
              <div className='grid grid-cols-2 gap-3'>
                <button
                  type='button'
                  onClick={() => handleDownloadFormatChange('TS')}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                    downloadFormat === 'TS'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-300 dark:border-white/10 hover:border-gray-400 dark:hover:border-white/15'
                  }`}
                >
                  <div className='flex flex-col items-center gap-2'>
                    <div
                      className={`text-2xl ${downloadFormat === 'TS' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      📦
                    </div>
                    <div className='text-center'>
                      <div
                        className={`text-sm font-semibold ${downloadFormat === 'TS' ? 'text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-gray-100'}`}
                      >
                        TS格式
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        推荐，兼容性好
                      </div>
                    </div>
                    {downloadFormat === 'TS' && (
                      <div className='w-5 h-5 rounded-full bg-primary-500 text-white flex items-center justify-center'>
                        <svg
                          className='w-3 h-3'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                        >
                          <path
                            fillRule='evenodd'
                            d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
                            clipRule='evenodd'
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>

                <button
                  type='button'
                  onClick={() => handleDownloadFormatChange('MP4')}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                    downloadFormat === 'MP4'
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-gray-300 dark:border-white/10 hover:border-gray-400 dark:hover:border-white/15'
                  }`}
                >
                  <div className='flex flex-col items-center gap-2'>
                    <div
                      className={`text-2xl ${downloadFormat === 'MP4' ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      🎬
                    </div>
                    <div className='text-center'>
                      <div
                        className={`text-sm font-semibold ${downloadFormat === 'MP4' ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'}`}
                      >
                        MP4格式
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        通用格式
                      </div>
                    </div>
                    {downloadFormat === 'MP4' && (
                      <div className='w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center'>
                        <svg
                          className='w-3 h-3'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                        >
                          <path
                            fillRule='evenodd'
                            d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
                            clipRule='evenodd'
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              </div>

              {/* 格式说明 */}
              <div className='text-xs text-gray-500 dark:text-gray-400 bg-primary-50 dark:bg-primary-500/10 p-3 rounded-lg border border-primary-200 dark:border-primary-500/20'>
                💡
                TS格式下载速度快，兼容性好；MP4格式经过转码，体积略小，兼容性更广
              </div>
            </div>
          </div>

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-primary-200/50 dark:border-white/[0.06]'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              这些设置保存在本地浏览器中
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 修改密码面板内容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/40 backdrop-blur-sm z-1000'
        onClick={handleCloseChangePassword}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 修改密码面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-primary-50/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl rounded-2xl shadow-2xl z-1001 overflow-hidden border border-primary-200/50 dark:border-white/10'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            // 阻止事件冒泡到遮罩层，但允许内部滚动
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto', // 允许所有触摸操作
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              修改密码
            </h3>
            <button
              onClick={handleCloseChangePassword}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 表单 */}
          <div className='space-y-4'>
            {/* 新密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                新密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请输入新密码'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 确认密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                确认密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请再次输入新密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 错误信息 */}
            {passwordError && (
              <div className='text-red-500 text-sm bg-red-50 dark:bg-red-500/10 p-3 rounded-md border border-red-200 dark:border-red-500/20'>
                {passwordError}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className='flex gap-3 mt-6 pt-4 border-t border-primary-200/50 dark:border-white/[0.06]'>
            <button
              onClick={handleCloseChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-colors'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmitChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-700 dark:hover:bg-primary-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={passwordLoading || !newPassword || !confirmPassword}
            >
              {passwordLoading ? '修改中...' : '确认修改'}
            </button>
          </div>

          {/* 底部说明 */}
          <div className='mt-4 pt-4 border-t border-primary-200/50 dark:border-white/[0.06]'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              修改密码后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 更新剧集海报弹窗内容
  const watchingUpdatesPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/40 backdrop-blur-sm z-1000'
        onClick={handleCloseWatchingUpdates}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 更新弹窗 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[90vh] bg-primary-50/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl rounded-2xl shadow-2xl z-1001 flex flex-col border border-primary-200/50 dark:border-white/10'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='flex-1 p-6 overflow-y-auto'
          data-panel-content
          style={{
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                更新提醒
              </h3>
              <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                {watchingUpdates && watchingUpdates.updatedCount > 0 && (
                  <span className='inline-flex items-center gap-1'>
                    <div className='w-2 h-2 bg-red-500 rounded-full animate-pulse'></div>
                    {watchingUpdates.updatedCount}部有新集
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleCloseWatchingUpdates}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-primary-100/50 dark:hover:bg-white/[0.06] transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 更新列表 */}
          <div className='space-y-8'>
            {/* 没有更新时的提示 */}
            {!hasActualUpdates && (
              <div className='text-center py-8'>
                <div className='text-gray-500 dark:text-gray-400 text-sm'>
                  暂无新剧集更新
                </div>
                <div className='text-xs text-gray-400 dark:text-gray-500 mt-2'>
                  系统会定期检查您观看过的剧集是否有新集数更新
                </div>
              </div>
            )}
            {/* 有新集数的剧集 */}
            {watchingUpdates &&
              watchingUpdates.updatedSeries.filter(
                (series) => series.hasNewEpisode,
              ).length > 0 && (
                <div>
                  <div className='flex items-center gap-2 mb-4'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-white'>
                      新集更新
                    </h4>
                    <div className='flex items-center gap-1'>
                      <div className='w-2 h-2 bg-red-500 rounded-full animate-pulse'></div>
                      <span className='text-sm text-red-500 font-medium'>
                        {
                          watchingUpdates.updatedSeries.filter(
                            (series) => series.hasNewEpisode,
                          ).length
                        }
                        部剧集有更新
                      </span>
                    </div>
                  </div>

                  <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
                    {watchingUpdates.updatedSeries
                      .filter((series) => series.hasNewEpisode)
                      .map((series, index) => (
                        <div
                          key={`new-${series.title}_${series.year}_${index}`}
                          className='relative group/card'
                        >
                          <div className='relative group-hover/card:z-5 transition-all duration-300'>
                            <VideoCard
                              title={series.title}
                              poster={series.cover}
                              year={series.year}
                              source={series.sourceKey}
                              source_name={series.source_name}
                              episodes={series.totalEpisodes}
                              currentEpisode={series.currentEpisode}
                              id={series.videoId}
                              onDelete={undefined}
                              type={series.totalEpisodes > 1 ? 'tv' : ''}
                              from='playrecord'
                            />
                          </div>
                          {/* 新集数徽章 - Netflix 统一风格 */}
                          <div className='absolute -top-2 -right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded-md shadow-lg animate-pulse z-10 font-bold'>
                            +{series.newEpisodes}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
          </div>

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-primary-200/50 dark:border-white/[0.06]'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              点击海报即可观看新更新的剧集
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 继续观看弹窗内容
  const continueWatchingPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/40 backdrop-blur-sm z-1000'
        onClick={handleCloseContinueWatching}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 继续观看弹窗 */}
      <div
        className='fixed inset-x-4 top-1/2 transform -translate-y-1/2 max-w-4xl mx-auto bg-primary-50/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl rounded-2xl shadow-2xl border border-primary-200/50 dark:border-white/10 z-1001 max-h-[80vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6'>
          <div className='flex items-center justify-between mb-4'>
            <h3 className='text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2'>
              <PlayCircle className='w-6 h-6 text-primary-500' />
              继续观看
            </h3>
            <button
              onClick={handleCloseContinueWatching}
              className='p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          {/* 播放记录网格 */}
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {playRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              const newEpisodesCount = getNewEpisodesCount(record);
              return (
                <div key={record.key} className='relative group/card'>
                  <div className='relative group-hover/card:z-5 transition-all duration-300'>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={record.total_episodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      type={record.total_episodes > 1 ? 'tv' : ''}
                      remarks={record.remarks}
                    />
                  </div>
                  {/* 新集数徽章 - Netflix 统一风格 */}
                  {newEpisodesCount > 0 && (
                    <div className='absolute -top-2 -right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded-md shadow-lg animate-pulse z-10 font-bold'>
                      +{newEpisodesCount}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 空状态 */}
          {playRecords.length === 0 && (
            <div className='text-center py-12'>
              <PlayCircle className='w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4' />
              <p className='text-gray-500 dark:text-gray-400 mb-2'>
                暂无需要继续观看的内容
              </p>
              <p className='text-xs text-gray-400 dark:text-gray-500'>
                {enableContinueWatchingFilter
                  ? `观看进度在${continueWatchingMinProgress}%-${continueWatchingMaxProgress}%之间且播放时间超过2分钟的内容会显示在这里`
                  : '播放时间超过2分钟的所有内容都会显示在这里'}
              </p>
            </div>
          )}

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-primary-200/50 dark:border-white/[0.06]'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              点击海报即可继续观看
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 我的收藏弹窗内容
  const favoritesPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/40 backdrop-blur-sm z-1000'
        onClick={handleCloseFavorites}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 收藏弹窗 */}
      <div
        className='fixed inset-x-4 top-1/2 transform -translate-y-1/2 max-w-4xl mx-auto bg-primary-50/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl rounded-2xl shadow-2xl border border-primary-200/50 dark:border-white/10 z-1001 max-h-[80vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6'>
          <div className='flex items-center justify-between mb-4'>
            <h3 className='text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2'>
              <Heart className='w-6 h-6 text-red-500' />
              我的收藏
            </h3>
            <button
              onClick={handleCloseFavorites}
              className='p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          {/* 收藏网格 */}
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {favorites.map((favorite) => {
              const { source, id } = parseKey(favorite.key);

              // 智能计算即将上映状态
              let calculatedRemarks = favorite.remarks;
              let isNewRelease = false;

              if (favorite.releaseDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const releaseDate = new Date(favorite.releaseDate);
                const daysDiff = Math.ceil(
                  (releaseDate.getTime() - today.getTime()) /
                    (1000 * 60 * 60 * 24),
                );

                // 根据天数差异动态更新显示文字
                if (daysDiff < 0) {
                  const daysAgo = Math.abs(daysDiff);
                  calculatedRemarks = `已上映${daysAgo}天`;
                  // 7天内上映的标记为新上映
                  if (daysAgo <= 7) {
                    isNewRelease = true;
                  }
                } else if (daysDiff === 0) {
                  calculatedRemarks = '今日上映';
                  isNewRelease = true;
                } else {
                  calculatedRemarks = `${daysDiff}天后上映`;
                }
              }

              return (
                <div key={favorite.key} className='relative'>
                  <VideoCard
                    id={id}
                    title={favorite.title}
                    poster={favorite.cover}
                    year={favorite.year}
                    source={source}
                    source_name={favorite.source_name}
                    episodes={favorite.total_episodes}
                    query={favorite.search_title}
                    from='favorite'
                    type={favorite.total_episodes > 1 ? 'tv' : ''}
                    remarks={calculatedRemarks}
                    releaseDate={favorite.releaseDate}
                  />
                  {/* 收藏心形图标 - 隐藏，使用VideoCard内部的hover爱心 */}
                  {/* 新上映高亮标记 - Netflix 统一风格 - 7天内上映的显示 */}
                  {isNewRelease && (
                    <div className='absolute top-2 left-2 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-md shadow-lg animate-pulse z-40'>
                      新上映
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 空状态 */}
          {favorites.length === 0 && (
            <div className='text-center py-12'>
              <Heart className='w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4' />
              <p className='text-gray-500 dark:text-gray-400 mb-2'>暂无收藏</p>
              <p className='text-xs text-gray-400 dark:text-gray-500'>
                在详情页点击收藏按钮即可添加收藏
              </p>
            </div>
          )}

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-primary-200/50 dark:border-white/[0.06]'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              点击海报即可进入详情页面
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className='relative w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:text-primary-500 dark:text-gray-300 dark:hover:text-primary-400 transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-primary-500/30 dark:hover:shadow-primary-400/30 group'
          aria-label='User Menu'
        >
          {/* 微光背景效果 */}
          <div className='absolute inset-0 rounded-full bg-linear-to-br from-primary-400/0 to-purple-600/0 group-hover:from-primary-400/20 group-hover:to-purple-600/20 dark:group-hover:from-primary-300/20 dark:group-hover:to-purple-500/20 transition-all duration-300'></div>

          <User className='w-full h-full relative z-10 group-hover:scale-110 transition-transform duration-300' />
        </button>
        {/* 统一更新提醒点：版本更新或剧集更新都显示橙色点 */}
        {hasUnreadUpdates && totalUpdates > 0 && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-yellow-500 rounded-full animate-pulse shadow-lg shadow-yellow-500/50'></div>
        )}
      </div>

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isSettingsOpen && mounted && createPortal(settingsPanel, document.body)}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {/* 使用 Portal 将更新提醒面板渲染到 document.body */}
      {isWatchingUpdatesOpen &&
        mounted &&
        createPortal(watchingUpdatesPanel, document.body)}

      {/* 使用 Portal 将继续观看面板渲染到 document.body */}
      {isContinueWatchingOpen &&
        mounted &&
        createPortal(continueWatchingPanel, document.body)}

      {/* 使用 Portal 将我的收藏面板渲染到 document.body */}
      {isFavoritesOpen &&
        mounted &&
        createPortal(favoritesPanel, document.body)}
    </>
  );
};
