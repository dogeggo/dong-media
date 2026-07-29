'use client';

import { getQueryClient } from './get-query-client';
import type {
  EpisodeSkipConfig,
  Favorite,
  PlayRecord,
  SkipSegment,
} from './types';
import {
  getCurrentUserDataScope,
  getUserDataStorageType,
  userDataQueryKey,
  type UserDataQueryKind,
  userQueryKeys,
} from './user-query-keys';

export type { EpisodeSkipConfig, Favorite, PlayRecord, SkipSegment };

const STORAGE_KEYS = {
  playRecords: 'moontv_play_records',
  favorites: 'moontv_favorites',
  searchHistory: 'moontv_search_history',
  skipConfigs: 'moontv_skip_configs',
} as const;

const SEARCH_HISTORY_LIMIT = 20;
const USER_DATA_EVENT = 'dongMediaUserDataChanged';
const USER_DATA_CHANNEL = 'dong-media-user-data-v2';

export type UserDataUpdateEvent =
  | 'playRecordsUpdated'
  | 'favoritesUpdated'
  | 'searchHistoryUpdated'
  | 'skipConfigsUpdated';

const eventKind: Record<UserDataUpdateEvent, UserDataQueryKind> = {
  playRecordsUpdated: 'play-records',
  favoritesUpdated: 'favorites',
  searchHistoryUpdated: 'search-history',
  skipConfigsUpdated: 'skip-configs',
};

interface UserDataChange {
  event: UserDataUpdateEvent;
  kind: UserDataQueryKind;
  scope: string;
  data?: unknown;
}

let channel: BroadcastChannel | null | undefined;

function getBroadcastChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    channel = null;
    return null;
  }
  channel = new BroadcastChannel(USER_DATA_CHANNEL);
  channel.addEventListener(
    'message',
    (message: MessageEvent<UserDataChange>) => {
      const change = message.data;
      const expectedKind = change ? eventKind[change.event] : undefined;
      if (
        !change ||
        !expectedKind ||
        change.kind !== expectedKind ||
        change.scope !== getCurrentUserDataScope()
      ) {
        return;
      }
      const queryClient = getQueryClient();
      void queryClient.invalidateQueries({
        queryKey: userDataQueryKey(change.kind, change.scope),
        exact: true,
      });
      if (change.kind === 'play-records') {
        void queryClient.invalidateQueries({
          queryKey: userQueryKeys.watchingUpdates(change.scope),
          exact: true,
        });
      }
      void refreshBroadcastChange(change);
    },
  );
  return channel;
}

function triggerGlobalError(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('globalError', { detail: { message } }));
}

function emitChange<T>(event: UserDataUpdateEvent, data: T): void {
  if (typeof window === 'undefined') return;
  const scope = getCurrentUserDataScope();
  const change: UserDataChange = {
    event,
    kind: eventKind[event],
    scope,
    data,
  };
  window.dispatchEvent(new CustomEvent(USER_DATA_EVENT, { detail: change }));
  getBroadcastChannel()?.postMessage({ ...change, data: undefined });
}

function updateQuery<T>(kind: UserDataQueryKind, data: T): void {
  if (typeof window === 'undefined') return;
  getBroadcastChannel();
  const scope = getCurrentUserDataScope();
  getQueryClient().setQueryData(userDataQueryKey(kind, scope), data);
  if (kind === 'play-records') {
    getQueryClient().removeQueries({
      queryKey: userQueryKeys.watchingUpdates(scope),
      exact: true,
    });
  }
}

async function refreshBroadcastChange(change: UserDataChange): Promise<void> {
  try {
    let data: unknown;
    switch (change.kind) {
      case 'play-records':
        data = await userDataRepository.getPlayRecords();
        break;
      case 'favorites':
        data = await userDataRepository.getFavorites();
        break;
      case 'search-history':
        data = await userDataRepository.getSearchHistory();
        break;
      case 'skip-configs':
        data = await userDataRepository.getSkipConfigs();
        break;
      case 'watching-updates':
        return;
    }
    window.dispatchEvent(
      new CustomEvent(USER_DATA_EVENT, {
        detail: { ...change, data } satisfies UserDataChange,
      }),
    );
  } catch {
    // The query remains invalidated and will retry through its normal consumer.
  }
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    triggerGlobalError('本地用户数据格式无效');
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `用户数据请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function isLocalStorageMode(): boolean {
  return getUserDataStorageType() === 'localstorage';
}

export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

export class UserDataRepository {
  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const records = isLocalStorageMode()
      ? readLocal<Record<string, PlayRecord>>(STORAGE_KEYS.playRecords, {})
      : await requestJson<Record<string, PlayRecord>>('/api/playrecords');
    updateQuery('play-records', records);
    return records;
  }

  async savePlayRecord(
    source: string,
    id: string,
    input: PlayRecord,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    const scope = getCurrentUserDataScope();
    const queryClient = getQueryClient();
    const localStorageMode = isLocalStorageMode();
    const knownRecords = localStorageMode
      ? readLocal<Record<string, PlayRecord>>(STORAGE_KEYS.playRecords, {})
      : queryClient.getQueryData<Record<string, PlayRecord>>(
          userQueryKeys.playRecords(scope),
        );
    const existing = knownRecords?.[key];
    const record: PlayRecord = { ...input };
    const originalEpisodes =
      record.original_episodes ||
      existing?.original_episodes ||
      existing?.total_episodes ||
      record.total_episodes;
    record.original_episodes =
      record.index > originalEpisodes && record.play_time > 60
        ? Math.max(record.total_episodes, existing?.total_episodes || 0)
        : originalEpisodes;

    if (localStorageMode) {
      const records = knownRecords || {};
      const next = { ...records, [key]: record };
      writeLocal(STORAGE_KEYS.playRecords, next);
      updateQuery('play-records', next);
      emitChange('playRecordsUpdated', next);
      return;
    }

    const result = await requestJson<{ record: PlayRecord }>(
      '/api/playrecords',
      {
        method: 'POST',
        body: JSON.stringify({ key, record }),
      },
    );
    const current =
      queryClient.getQueryData<Record<string, PlayRecord>>(
        userQueryKeys.playRecords(scope),
      ) || knownRecords;
    if (current) {
      const next = { ...current, [key]: result.record };
      updateQuery('play-records', next);
      emitChange('playRecordsUpdated', next);
    } else {
      const refreshed = await this.getPlayRecords();
      emitChange('playRecordsUpdated', refreshed);
    }
  }

  async deletePlayRecord(source: string, id: string): Promise<PlayRecord> {
    const key = generateStorageKey(source, id);
    const scope = getCurrentUserDataScope();
    const queryClient = getQueryClient();
    const localStorageMode = isLocalStorageMode();
    let records = localStorageMode
      ? readLocal<Record<string, PlayRecord>>(STORAGE_KEYS.playRecords, {})
      : queryClient.getQueryData<Record<string, PlayRecord>>(
          userQueryKeys.playRecords(scope),
        );
    let deleted = records?.[key];

    if (localStorageMode) {
      const next = { ...(records || {}) };
      delete next[key];
      writeLocal(STORAGE_KEYS.playRecords, next);
      updateQuery('play-records', next);
      emitChange('playRecordsUpdated', next);
    } else {
      const result = await requestJson<{ record: PlayRecord | null }>(
        `/api/playrecords?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      deleted = result.record || deleted;
      if (records) {
        records = { ...records };
        delete records[key];
        updateQuery('play-records', records);
        emitChange('playRecordsUpdated', records);
      } else {
        records = await this.getPlayRecords();
        emitChange('playRecordsUpdated', records);
      }
    }

    if (!deleted) throw new Error('播放记录不存在');
    return deleted;
  }

  async clearPlayRecords(): Promise<void> {
    if (isLocalStorageMode()) localStorage.removeItem(STORAGE_KEYS.playRecords);
    else await requestJson('/api/playrecords', { method: 'DELETE' });
    updateQuery('play-records', {});
    emitChange('playRecordsUpdated', {});
  }

  async getFavorites(): Promise<Record<string, Favorite>> {
    const favorites = isLocalStorageMode()
      ? readLocal<Record<string, Favorite>>(STORAGE_KEYS.favorites, {})
      : await requestJson<Record<string, Favorite>>('/api/favorites');
    updateQuery('favorites', favorites);
    return favorites;
  }

  async saveFavorite(
    source: string,
    id: string,
    favorite: Favorite,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    let favorites: Record<string, Favorite>;
    if (isLocalStorageMode()) {
      favorites = readLocal<Record<string, Favorite>>(
        STORAGE_KEYS.favorites,
        {},
      );
      favorites = { ...favorites, [key]: favorite };
      writeLocal(STORAGE_KEYS.favorites, favorites);
    } else {
      const result = await requestJson<{ favorites: Record<string, Favorite> }>(
        '/api/favorites',
        {
          method: 'POST',
          body: JSON.stringify({ key, favorite }),
        },
      );
      favorites = result.favorites;
    }
    updateQuery('favorites', favorites);
    emitChange('favoritesUpdated', favorites);
  }

  async deleteFavorite(source: string, id: string): Promise<void> {
    const key = generateStorageKey(source, id);
    let favorites: Record<string, Favorite>;
    if (isLocalStorageMode()) {
      favorites = readLocal<Record<string, Favorite>>(
        STORAGE_KEYS.favorites,
        {},
      );
      favorites = { ...favorites };
      delete favorites[key];
      writeLocal(STORAGE_KEYS.favorites, favorites);
    } else {
      const result = await requestJson<{ favorites: Record<string, Favorite> }>(
        `/api/favorites?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      favorites = result.favorites;
    }
    updateQuery('favorites', favorites);
    emitChange('favoritesUpdated', favorites);
  }

  async clearFavorites(): Promise<void> {
    if (isLocalStorageMode()) localStorage.removeItem(STORAGE_KEYS.favorites);
    else await requestJson('/api/favorites', { method: 'DELETE' });
    updateQuery('favorites', {});
    emitChange('favoritesUpdated', {});
  }

  async getSearchHistory(): Promise<string[]> {
    const history = isLocalStorageMode()
      ? readLocal<string[]>(STORAGE_KEYS.searchHistory, [])
      : await requestJson<string[]>('/api/searchhistory');
    updateQuery('search-history', history);
    return history;
  }

  async addSearchHistory(keyword: string): Promise<void> {
    const value = keyword.trim();
    if (!value) return;
    let history: string[];
    if (isLocalStorageMode()) {
      const current = readLocal<string[]>(STORAGE_KEYS.searchHistory, []);
      history = [value, ...current.filter((item) => item !== value)].slice(
        0,
        SEARCH_HISTORY_LIMIT,
      );
      writeLocal(STORAGE_KEYS.searchHistory, history);
    } else {
      history = await requestJson<string[]>('/api/searchhistory', {
        method: 'POST',
        body: JSON.stringify({ keyword: value }),
      });
    }
    updateQuery('search-history', history);
    emitChange('searchHistoryUpdated', history);
  }

  async deleteSearchHistory(keyword?: string): Promise<void> {
    let history: string[];
    if (isLocalStorageMode()) {
      const current = readLocal<string[]>(STORAGE_KEYS.searchHistory, []);
      history = keyword ? current.filter((item) => item !== keyword) : [];
      writeLocal(STORAGE_KEYS.searchHistory, history);
    } else {
      const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
      const result = await requestJson<{ history: string[] }>(
        `/api/searchhistory${query}`,
        { method: 'DELETE' },
      );
      history = result.history;
    }
    updateQuery('search-history', history);
    emitChange('searchHistoryUpdated', history);
  }

  async getSkipConfig(
    source: string,
    id: string,
  ): Promise<EpisodeSkipConfig | null> {
    const key = generateStorageKey(source, id);
    if (isLocalStorageMode()) {
      return (
        readLocal<Record<string, EpisodeSkipConfig>>(
          STORAGE_KEYS.skipConfigs,
          {},
        )[key] || null
      );
    }
    const result = await requestJson<{ config: EpisodeSkipConfig | null }>(
      '/api/skipconfigs',
      { method: 'POST', body: JSON.stringify({ action: 'get', key }) },
    );
    return result.config;
  }

  async getSkipConfigs(): Promise<Record<string, EpisodeSkipConfig>> {
    const configs = isLocalStorageMode()
      ? readLocal<Record<string, EpisodeSkipConfig>>(
          STORAGE_KEYS.skipConfigs,
          {},
        )
      : (
          await requestJson<{
            configs: Record<string, EpisodeSkipConfig>;
          }>('/api/skipconfigs', {
            method: 'POST',
            body: JSON.stringify({ action: 'getAll' }),
          })
        ).configs;
    updateQuery('skip-configs', configs);
    return configs;
  }

  async saveSkipConfig(
    source: string,
    id: string,
    config: EpisodeSkipConfig,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    let configs: Record<string, EpisodeSkipConfig>;
    if (isLocalStorageMode()) {
      configs = readLocal<Record<string, EpisodeSkipConfig>>(
        STORAGE_KEYS.skipConfigs,
        {},
      );
      configs = { ...configs, [key]: config };
      writeLocal(STORAGE_KEYS.skipConfigs, configs);
    } else {
      const result = await requestJson<{
        configs: Record<string, EpisodeSkipConfig>;
      }>('/api/skipconfigs', {
        method: 'POST',
        body: JSON.stringify({ action: 'set', key, config }),
      });
      configs = result.configs;
    }
    updateQuery('skip-configs', configs);
    emitChange('skipConfigsUpdated', configs);
  }

  async deleteSkipConfig(source: string, id: string): Promise<void> {
    const key = generateStorageKey(source, id);
    let configs: Record<string, EpisodeSkipConfig>;
    if (isLocalStorageMode()) {
      configs = readLocal<Record<string, EpisodeSkipConfig>>(
        STORAGE_KEYS.skipConfigs,
        {},
      );
      configs = { ...configs };
      delete configs[key];
      writeLocal(STORAGE_KEYS.skipConfigs, configs);
    } else {
      const result = await requestJson<{
        configs: Record<string, EpisodeSkipConfig>;
      }>('/api/skipconfigs', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', key }),
      });
      configs = result.configs;
    }
    updateQuery('skip-configs', configs);
    emitChange('skipConfigsUpdated', configs);
  }
}

export const userDataRepository = new UserDataRepository();

export async function getAllPlayRecords(
  _forceRefresh = false,
): Promise<Record<string, PlayRecord>> {
  return userDataRepository.getPlayRecords();
}

export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord,
): Promise<void> {
  try {
    await userDataRepository.savePlayRecord(source, id, record);
  } catch (error) {
    triggerGlobalError('保存播放记录失败');
    throw error;
  }
}

export function deletePlayRecord(
  source: string,
  id: string,
): Promise<PlayRecord> {
  return userDataRepository.deletePlayRecord(source, id);
}

export function clearAllPlayRecords(): Promise<void> {
  return userDataRepository.clearPlayRecords();
}

export function getAllFavorites(): Promise<Record<string, Favorite>> {
  return userDataRepository.getFavorites();
}

export function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite,
): Promise<void> {
  return userDataRepository.saveFavorite(source, id, favorite);
}

export function deleteFavorite(source: string, id: string): Promise<void> {
  return userDataRepository.deleteFavorite(source, id);
}

export async function isFavorited(
  source: string,
  id: string,
): Promise<boolean> {
  const favorites = await userDataRepository.getFavorites();
  return Boolean(favorites[generateStorageKey(source, id)]);
}

export function clearAllFavorites(): Promise<void> {
  return userDataRepository.clearFavorites();
}

export function getSearchHistory(): Promise<string[]> {
  return userDataRepository.getSearchHistory();
}

export function addSearchHistory(keyword: string): Promise<void> {
  return userDataRepository.addSearchHistory(keyword);
}

export function clearSearchHistory(): Promise<void> {
  return userDataRepository.deleteSearchHistory();
}

export function deleteSearchHistory(keyword: string): Promise<void> {
  return userDataRepository.deleteSearchHistory(keyword);
}

export function getSkipConfig(
  source: string,
  id: string,
): Promise<EpisodeSkipConfig | null> {
  return userDataRepository.getSkipConfig(source, id);
}

export function saveSkipConfig(
  source: string,
  id: string,
  config: EpisodeSkipConfig,
): Promise<void> {
  return userDataRepository.saveSkipConfig(source, id, config);
}

export function getAllSkipConfigs(): Promise<
  Record<string, EpisodeSkipConfig>
> {
  return userDataRepository.getSkipConfigs();
}

export function deleteSkipConfig(source: string, id: string): Promise<void> {
  return userDataRepository.deleteSkipConfig(source, id);
}

export function subscribeToDataUpdates<T>(
  event: UserDataUpdateEvent,
  callback: (data: T) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (rawEvent: Event) => {
    const change = (rawEvent as CustomEvent<UserDataChange>).detail;
    if (change?.event === event) callback(change.data as T);
  };
  window.addEventListener(USER_DATA_EVENT, listener);
  getBroadcastChannel();
  return () => window.removeEventListener(USER_DATA_EVENT, listener);
}
