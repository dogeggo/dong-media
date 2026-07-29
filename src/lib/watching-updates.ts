'use client';

import {
  generateStorageKey,
  getAllPlayRecords,
  type PlayRecord,
} from './db.client';
import { getQueryClient } from './get-query-client';
import { getCurrentUserDataScope, userQueryKeys } from './user-query-keys';

const WATCHING_UPDATES_STALE_TIME = 5 * 60 * 1_000;

export const WATCHING_UPDATES_EVENT = 'watchingUpdatesChanged';

export interface WatchingUpdate {
  hasUpdates: boolean;
  timestamp: number;
  updatedCount: number;
  continueWatchingCount: number;
  updatedSeries: Array<{
    title: string;
    source_name: string;
    year: string;
    cover: string;
    sourceKey: string;
    videoId: string;
    currentEpisode: number;
    totalEpisodes: number;
    hasNewEpisode: boolean;
    hasContinueWatching: boolean;
    newEpisodes?: number;
    remainingEpisodes?: number;
    latestEpisodes?: number;
    remarks?: string;
  }>;
}

interface UpdateStatus {
  hasUpdate: boolean;
  hasContinueWatching: boolean;
  newEpisodes: number;
  remainingEpisodes: number;
  latestEpisodes: number;
}

interface SourceDefinition {
  key: string;
  name: string;
}

export async function checkWatchingUpdates(
  forceRefresh = false,
): Promise<void> {
  const queryClient = getQueryClient();
  const scope = getCurrentUserDataScope();
  const queryKey = userQueryKeys.watchingUpdates(scope);
  if (forceRefresh) {
    queryClient.removeQueries({ queryKey, exact: true });
  }

  try {
    const result = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => calculateWatchingUpdates(forceRefresh),
      staleTime: WATCHING_UPDATES_STALE_TIME,
      gcTime: 10 * 60 * 1_000,
    });
    notify(result);
  } catch {
    notify(emptyWatchingUpdate());
  }
}

async function calculateWatchingUpdates(
  forceRefresh: boolean,
): Promise<WatchingUpdate> {
  const recordsByKey = await getAllPlayRecords(forceRefresh);
  const candidates = Object.entries(recordsByKey)
    .map(([key, record]) => ({ key, record }))
    .filter(({ record }) => record.total_episodes > 1);
  if (candidates.length === 0) return emptyWatchingUpdate();

  const sources = await loadSources();
  const updatedSeries = await Promise.all(
    candidates.map(async ({ key, record }) => {
      const { sourceKey, videoId } = splitStorageKey(key);
      const status = await checkSingleRecordUpdate(
        record,
        videoId,
        sourceKey,
        sources,
      );
      return {
        title: record.title,
        source_name: record.source_name,
        year: record.year,
        cover: record.cover,
        sourceKey,
        videoId,
        currentEpisode: record.index,
        totalEpisodes: status.latestEpisodes,
        hasNewEpisode: status.hasUpdate,
        hasContinueWatching: status.hasContinueWatching,
        newEpisodes: status.newEpisodes,
        remainingEpisodes: status.remainingEpisodes,
        latestEpisodes: status.latestEpisodes,
        remarks: record.remarks,
      };
    }),
  );

  updatedSeries.sort((left, right) => {
    if (left.hasNewEpisode !== right.hasNewEpisode) {
      return left.hasNewEpisode ? -1 : 1;
    }
    if (left.hasContinueWatching !== right.hasContinueWatching) {
      return left.hasContinueWatching ? -1 : 1;
    }
    return left.title.localeCompare(right.title, 'zh-CN');
  });

  const updatedCount = updatedSeries.filter(
    (series) => series.hasNewEpisode,
  ).length;
  const continueWatchingCount = updatedSeries.filter(
    (series) => series.hasContinueWatching,
  ).length;
  return {
    hasUpdates: updatedCount > 0 || continueWatchingCount > 0,
    timestamp: Date.now(),
    updatedCount,
    continueWatchingCount,
    updatedSeries,
  };
}

async function checkSingleRecordUpdate(
  record: PlayRecord,
  videoId: string,
  storageSourceName: string,
  sources: SourceDefinition[],
): Promise<UpdateStatus> {
  const originalEpisodes =
    record.original_episodes && record.original_episodes > 0
      ? record.original_episodes
      : record.total_episodes;
  const completed = isSeriesCompleted(record);

  try {
    const source = sources.find(
      (candidate) =>
        candidate.key === record.source_name ||
        candidate.name === record.source_name ||
        candidate.key === storageSourceName,
    );
    const response = await fetch(
      `/api/detail?source=${encodeURIComponent(source?.key || storageSourceName)}&id=${encodeURIComponent(videoId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok)
      throw new Error(`Detail request failed: ${response.status}`);
    const data = (await response.json()) as { episodes?: unknown[] };
    const upstreamEpisodes = Array.isArray(data.episodes)
      ? data.episodes.length
      : 0;
    const latestEpisodes = Math.max(
      upstreamEpisodes,
      originalEpisodes,
      record.total_episodes,
    );
    const hasUpdate = !completed && upstreamEpisodes > originalEpisodes;
    const hasContinueWatching = record.index < latestEpisodes;
    return {
      hasUpdate,
      hasContinueWatching,
      newEpisodes: hasUpdate ? upstreamEpisodes - originalEpisodes : 0,
      remainingEpisodes: hasContinueWatching
        ? latestEpisodes - record.index
        : 0,
      latestEpisodes,
    };
  } catch {
    return statusFromRecord(record, originalEpisodes);
  }
}

async function loadSources(): Promise<SourceDefinition[]> {
  try {
    const response = await fetch('/api/sources', { cache: 'no-store' });
    if (!response.ok) return [];
    const value = (await response.json()) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is SourceDefinition =>
          Boolean(
            item &&
            typeof item === 'object' &&
            typeof (item as SourceDefinition).key === 'string' &&
            typeof (item as SourceDefinition).name === 'string',
          ),
        )
      : [];
  } catch {
    return [];
  }
}

function statusFromRecord(
  record: PlayRecord,
  originalEpisodes: number,
): UpdateStatus {
  const latestEpisodes = Math.max(originalEpisodes, record.total_episodes);
  const hasContinueWatching = record.index < latestEpisodes;
  return {
    hasUpdate: false,
    hasContinueWatching,
    newEpisodes: 0,
    remainingEpisodes: hasContinueWatching ? latestEpisodes - record.index : 0,
    latestEpisodes,
  };
}

function isSeriesCompleted(record: PlayRecord): boolean {
  return ['已完结', '完结', '全集'].some((keyword) =>
    record.remarks?.includes(keyword),
  );
}

function splitStorageKey(key: string): {
  sourceKey: string;
  videoId: string;
} {
  const separator = key.indexOf('+');
  if (separator < 0) return { sourceKey: key, videoId: '' };
  return {
    sourceKey: key.slice(0, separator),
    videoId: key.slice(separator + 1),
  };
}

function emptyWatchingUpdate(): WatchingUpdate {
  return {
    hasUpdates: false,
    timestamp: Date.now(),
    updatedCount: 0,
    continueWatchingCount: 0,
    updatedSeries: [],
  };
}

export function getCachedWatchingUpdates(): boolean {
  return getDetailedWatchingUpdates()?.hasUpdates || false;
}

export function getDetailedWatchingUpdates(): WatchingUpdate | null {
  const queryClient = getQueryClient();
  const queryKey = userQueryKeys.watchingUpdates(getCurrentUserDataScope());
  const state = queryClient.getQueryState<WatchingUpdate>(queryKey);
  if (
    !state?.data ||
    Date.now() - state.dataUpdatedAt > WATCHING_UPDATES_STALE_TIME
  ) {
    return null;
  }
  return state.data;
}

export function markUpdatesAsViewed(): void {
  const queryClient = getQueryClient();
  const queryKey = userQueryKeys.watchingUpdates(getCurrentUserDataScope());
  const current = queryClient.getQueryData<WatchingUpdate>(queryKey);
  if (!current) return;
  const next: WatchingUpdate = {
    ...current,
    hasUpdates: false,
    updatedCount: 0,
    updatedSeries: current.updatedSeries.map((series) => ({
      ...series,
      hasNewEpisode: false,
    })),
  };
  queryClient.setQueryData(queryKey, next);
  notify(next);
}

export function clearWatchingUpdates(): void {
  forceClearWatchingUpdatesCache();
  notify(emptyWatchingUpdate());
}

export function forceClearWatchingUpdatesCache(): void {
  getQueryClient().removeQueries({
    queryKey: userQueryKeys.watchingUpdates(getCurrentUserDataScope()),
    exact: true,
  });
}

export function subscribeToWatchingUpdates(
  callback: (hasUpdates: boolean) => void,
): () => void {
  return subscribeToWatchingUpdatesEvent((hasUpdates) => callback(hasUpdates));
}

export function setupPeriodicUpdateCheck(intervalMinutes = 30): () => void {
  void checkWatchingUpdates();
  const interval = window.setInterval(
    () => void checkWatchingUpdates(),
    intervalMinutes * 60 * 1_000,
  );
  return () => window.clearInterval(interval);
}

export function setupVisibilityChangeCheck(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = () => {
    if (!document.hidden) void checkWatchingUpdates();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

export async function checkVideoUpdate(
  sourceName: string,
  videoId: string,
): Promise<void> {
  const records = await getAllPlayRecords();
  const record = records[generateStorageKey(sourceName, videoId)];
  if (!record) return;
  const status = await checkSingleRecordUpdate(
    record,
    videoId,
    sourceName,
    await loadSources(),
  );
  if (status.hasUpdate) await checkWatchingUpdates(true);
}

export function subscribeToWatchingUpdatesEvent(
  callback: (hasUpdates: boolean, updatedCount: number) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WatchingUpdate>).detail;
    callback(Boolean(detail?.hasUpdates), detail?.updatedCount || 0);
  };
  window.addEventListener(WATCHING_UPDATES_EVENT, listener);
  return () => window.removeEventListener(WATCHING_UPDATES_EVENT, listener);
}

function notify(result: WatchingUpdate): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(WATCHING_UPDATES_EVENT, { detail: result }),
  );
}
