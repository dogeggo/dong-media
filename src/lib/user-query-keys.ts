'use client';

import { getAuthInfoFromBrowserCookie } from './auth';

export type UserDataQueryKind =
  | 'play-records'
  | 'favorites'
  | 'search-history'
  | 'skip-configs'
  | 'watching-updates';

export const userQueryKeys = {
  all: (scope: string) => ['user-data', scope] as const,
  playRecords: (scope: string) =>
    [...userQueryKeys.all(scope), 'play-records'] as const,
  favorites: (scope: string) =>
    [...userQueryKeys.all(scope), 'favorites'] as const,
  searchHistory: (scope: string) =>
    [...userQueryKeys.all(scope), 'search-history'] as const,
  skipConfigs: (scope: string) =>
    [...userQueryKeys.all(scope), 'skip-configs'] as const,
  watchingUpdates: (scope: string) =>
    [...userQueryKeys.all(scope), 'watching-updates'] as const,
};

export function getUserDataStorageType(): 'localstorage' | 'redis' | 'kvrocks' {
  if (typeof window === 'undefined') return 'localstorage';
  const runtimeConfig = (
    window as typeof window & {
      RUNTIME_CONFIG?: { STORAGE_TYPE?: string };
    }
  ).RUNTIME_CONFIG;
  const value =
    runtimeConfig?.STORAGE_TYPE ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage';
  return value === 'redis' || value === 'kvrocks' ? value : 'localstorage';
}

export function getCurrentUserDataScope(): string {
  const storageType = getUserDataStorageType();
  if (storageType === 'localstorage') return 'localstorage:primary';
  const username = getAuthInfoFromBrowserCookie()?.username || 'anonymous';
  return `${storageType}:${username}`;
}

export function userDataQueryKey(kind: UserDataQueryKind, scope: string) {
  switch (kind) {
    case 'play-records':
      return userQueryKeys.playRecords(scope);
    case 'favorites':
      return userQueryKeys.favorites(scope);
    case 'search-history':
      return userQueryKeys.searchHistory(scope);
    case 'skip-configs':
      return userQueryKeys.skipConfigs(scope);
    case 'watching-updates':
      return userQueryKeys.watchingUpdates(scope);
  }
}
