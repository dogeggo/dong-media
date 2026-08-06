'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import { clearAllPlayRecords, getAllPlayRecords } from '@/lib/db.client';
import { getCurrentUserDataScope, userQueryKeys } from '@/lib/user-query-keys';
import {
  checkWatchingUpdates,
  getDetailedWatchingUpdates,
  subscribeToWatchingUpdatesEvent,
  type WatchingUpdate,
} from '@/lib/watching-updates';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import ScrollableRow from '@/components/ScrollableRow';
import SectionTitle from '@/components/SectionTitle';
import SkeletonCard from '@/components/SkeletonCard';

const VideoCard = dynamic(() => import('@/components/VideoCard'), {
  ssr: false,
  loading: () => <SkeletonCard />,
});

interface ContinueWatchingProps {
  className?: string;
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const queryClient = useQueryClient();
  const userDataScope = getCurrentUserDataScope();
  const playRecordsQueryKey = userQueryKeys.playRecords(userDataScope);
  const [watchingUpdates, setWatchingUpdates] = useState<WatchingUpdate | null>(
    null,
  );
  const [requireClearConfirmation, setRequireClearConfirmation] =
    useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // 读取清空确认设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedRequireClearConfirmation = localStorage.getItem(
        'requireClearConfirmation',
      );
      if (savedRequireClearConfirmation !== null) {
        setRequireClearConfirmation(JSON.parse(savedRequireClearConfirmation));
      }
    }
  }, []);

  const { data: allPlayRecords = {}, isLoading } = useQuery({
    queryKey: playRecordsQueryKey,
    queryFn: () => getAllPlayRecords(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: () =>
      queryClient.getQueryData<Record<string, PlayRecord>>(playRecordsQueryKey),
  });

  const playRecords = useMemo<(PlayRecord & { key: string })[]>(() => {
    const recordsArray = Object.entries(allPlayRecords).map(
      ([key, record]) => ({
        ...record,
        key,
      }),
    );

    return recordsArray.sort((a, b) => b.save_time - a.save_time);
  }, [allPlayRecords]);

  // 获取 watching updates 数据（仅当有播放记录时）
  useEffect(() => {
    if (isLoading || playRecords.length === 0) {
      return;
    }

    const cachedUpdates = getDetailedWatchingUpdates();
    if (cachedUpdates) setWatchingUpdates(cachedUpdates);

    let cancelled = false;
    let scheduled = false;
    let delayTimer: number | null = null;
    let idleCallback: number | null = null;

    const runUpdateCheck = async () => {
      scheduled = false;
      if (cancelled || document.hidden) return;
      await checkWatchingUpdates();
      if (!cancelled) setWatchingUpdates(getDetailedWatchingUpdates());
    };

    const scheduleUpdateCheck = () => {
      if (cachedUpdates || cancelled || scheduled || document.hidden) return;
      scheduled = true;
      delayTimer = window.setTimeout(() => {
        delayTimer = null;
        if ('requestIdleCallback' in window) {
          idleCallback = window.requestIdleCallback(runUpdateCheck, {
            timeout: 4_000,
          });
        } else {
          void runUpdateCheck();
        }
      }, 4_000);
    };

    const handleLoad = () => scheduleUpdateCheck();
    const handleVisibilityChange = () => {
      if (!document.hidden) scheduleUpdateCheck();
    };

    if (document.readyState === 'complete') scheduleUpdateCheck();
    else window.addEventListener('load', handleLoad, { once: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 订阅 watching updates 事件
    const unsubscribeWatchingUpdates = subscribeToWatchingUpdatesEvent(() => {
      const updates = getDetailedWatchingUpdates();
      setWatchingUpdates(updates);
    });

    return () => {
      cancelled = true;
      window.removeEventListener('load', handleLoad);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      if (idleCallback !== null) window.cancelIdleCallback(idleCallback);
      unsubscribeWatchingUpdates();
    };
  }, [isLoading, playRecords.length]);

  if (!isLoading && playRecords.length === 0) {
    return null;
  }

  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  const getNewEpisodesCount = (
    record: PlayRecord & { key: string },
  ): number => {
    if (!watchingUpdates || !watchingUpdates.updatedSeries) return 0;

    const { source, id } = parseKey(record.key);

    const matchedSeries = watchingUpdates.updatedSeries.find(
      (series) =>
        series.sourceKey === source &&
        series.videoId === id &&
        series.hasNewEpisode,
    );

    return matchedSeries ? matchedSeries.newEpisodes || 0 : 0;
  };

  const getLatestTotalEpisodes = (
    record: PlayRecord & { key: string },
  ): number => {
    if (!watchingUpdates || !watchingUpdates.updatedSeries)
      return record.total_episodes;

    const { source, id } = parseKey(record.key);

    const matchedSeries = watchingUpdates.updatedSeries.find(
      (series) => series.sourceKey === source && series.videoId === id,
    );

    return matchedSeries && matchedSeries.totalEpisodes
      ? matchedSeries.totalEpisodes
      : record.total_episodes;
  };

  const handleClearAll = async () => {
    await clearAllPlayRecords();
    queryClient.setQueryData(playRecordsQueryKey, {});
  };

  return (
    <section className={`sm:mb-8 ${className || ''}`}>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='继续观看'
          icon={Clock}
          iconColor='text-primary-500'
        />
        {!isLoading && playRecords.length > 0 && (
          <button
            className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 dark:text-red-400 dark:hover:text-white dark:hover:bg-red-500 border border-red-300 dark:border-red-700 hover:border-red-600 dark:hover:border-red-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
            onClick={() => {
              // 根据用户设置决定是否显示确认对话框
              if (requireClearConfirmation) {
                setShowConfirmDialog(true);
              } else {
                handleClearAll();
              }
            }}
          >
            <Trash2 className='w-4 h-4' />
            <span>清空</span>
          </button>
        )}
      </div>

      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={showConfirmDialog}
        title='确认清空'
        message={`确定要清空所有继续观看记录吗？\n\n这将删除 ${playRecords.length} 条播放记录，此操作无法撤销。`}
        confirmText='确认清空'
        cancelText='取消'
        variant='danger'
        onConfirm={handleClearAll}
        onCancel={() => setShowConfirmDialog(false)}
      />
      <ScrollableRow>
        {isLoading
          ? // 加载状态显示灰色占位数据
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className='min-w-24 w-24 sm:min-w-45 sm:w-44'>
                <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse motion-reduce:animate-none dark:bg-gray-800'>
                  <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                </div>
                <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse motion-reduce:animate-none dark:bg-gray-800'></div>
                <div className='mt-1 h-3 bg-gray-200 rounded animate-pulse motion-reduce:animate-none dark:bg-gray-800'></div>
              </div>
            ))
          : // 显示真实数据
            playRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              const newEpisodesCount = getNewEpisodesCount(record);
              const latestTotalEpisodes = getLatestTotalEpisodes(record);
              return (
                <div
                  key={record.key}
                  className='min-w-24 w-24 sm:min-w-45 sm:w-44 relative group/card'
                >
                  <div className='relative group-hover/card:z-5 transition-all duration-300'>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={latestTotalEpisodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      onDelete={() =>
                        queryClient.setQueryData<Record<string, PlayRecord>>(
                          playRecordsQueryKey,
                          (prev) => {
                            if (!prev) return prev;
                            const updated = { ...prev };
                            delete updated[record.key];
                            return updated;
                          },
                        )
                      }
                      type={latestTotalEpisodes > 1 ? 'tv' : ''}
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
      </ScrollableRow>
    </section>
  );
}
