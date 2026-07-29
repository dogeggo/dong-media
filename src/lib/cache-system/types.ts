export type CacheScope = 'public' | 'user' | 'system';

export type CacheLayer =
  | 'memory'
  | 'shared'
  | 'browser'
  | 'cdn'
  | 'disk'
  | 'r2';

export interface CachePolicy {
  namespace: string;
  version: number;
  scope: CacheScope;
  freshTtlSeconds: number;
  staleTtlSeconds?: number;
  negativeTtlSeconds?: number;
  jitterRatio?: number;
  layers: CacheLayer[];
  maxEntryBytes?: number;
  tags: string[];
  cacheErrors: false;
}

export interface CacheEntry<T> {
  schemaVersion: 1;
  value: T;
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
  sourceVersion?: string;
  contentType?: string;
  etag?: string;
  negative?: boolean;
}

export type CacheLayerResult = 'L1' | 'L2' | 'ORIGIN';
export type CacheStatus = 'HIT' | 'MISS' | 'STALE' | 'ERROR';

export interface CacheResult<T> {
  value: T;
  key: string;
  namespace: string;
  layer: CacheLayerResult;
  status: CacheStatus;
  ttlRemaining: number;
  negative: boolean;
}

export interface CacheLoadOptions<T> {
  scope?: string;
  sourceVersion?: string;
  isNegative?: (value: T) => boolean;
  validate?: (value: T) => boolean;
  forceRefresh?: boolean;
}

export interface CacheNamespaceStats {
  namespace: string;
  entries: number;
  estimatedBytes: number;
  hits: number;
  misses: number;
  staleHits: number;
  errors: number;
  writes: number;
  rejectedWrites: number;
  coalescedLoads: number;
}

export interface CacheLayerStats {
  layer: 'L1' | 'L2';
  entries: number;
  estimatedBytes: number;
  oldestCreatedAt?: number;
  newestAccessAt?: number;
  expiredEntries?: number;
  byNamespace?: Record<string, { entries: number; estimatedBytes: number }>;
}

export interface CacheInvalidationResult {
  namespace: string;
  generation: number;
  localEntriesRemoved: number;
  shared: boolean;
}

export interface SharedCacheAdapter {
  isAvailable(): boolean;
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<number>;
  getGeneration(namespace: string): Promise<number>;
  ensureGeneration(
    namespace: string,
    minimumGeneration: number,
  ): Promise<number>;
  incrementGeneration(
    namespace: string,
    minimumGeneration?: number,
  ): Promise<number>;
  stats(): Promise<CacheLayerStats>;
}
