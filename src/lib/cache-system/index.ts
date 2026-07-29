import { RedisCacheAdapter } from './adapters/redis';
import { CacheService } from './server';

export const cacheService = new CacheService({
  shared: new RedisCacheAdapter(),
});

export { CacheService };
export {
  applyNoStore,
  conditionalResponseHeaders,
  noStoreResponseHeaders,
  privateResponseHeaders,
  publicApiResponseHeaders,
  STATIC_MEDIA_TTL_SECONDS,
  staticMediaResponseHeaders,
} from './http';
export {
  buildCacheKey,
  getCacheEnvironmentName,
  hashCacheValue,
  hasOnlyUniqueSearchParams,
  normalizeQuery,
  stableSerialize,
} from './keys';
export {
  ALL_CACHE_POLICIES,
  CACHE_POLICIES,
  getCachePolicy,
  getPoliciesByTag,
} from './policies';
export type {
  CacheEntry,
  CacheInvalidationResult,
  CacheLayer,
  CacheLayerStats,
  CacheLoadOptions,
  CacheNamespaceStats,
  CachePolicy,
  CacheResult,
  CacheScope,
  SharedCacheAdapter,
} from './types';
