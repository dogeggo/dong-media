import { MemoryCacheAdapter } from './adapters/memory.ts';
import { buildCacheKey } from './keys.ts';
import { type CacheMetrics, cacheMetrics } from './metrics.ts';
import { ALL_CACHE_POLICIES, getPoliciesByTag } from './policies.ts';
import type {
  CacheEntry,
  CacheInvalidationResult,
  CacheLayerStats,
  CacheLoadOptions,
  CacheNamespaceStats,
  CachePolicy,
  CacheResult,
  SharedCacheAdapter,
} from './types.ts';

interface CacheServiceOptions {
  memory?: MemoryCacheAdapter;
  shared?: SharedCacheAdapter;
  metrics?: CacheMetrics;
  now?: () => number;
  random?: () => number;
}

interface StaleCandidate<T> {
  entry: CacheEntry<T>;
  layer: 'L1' | 'L2';
}

export class CacheService {
  private readonly memory: MemoryCacheAdapter;
  private readonly shared: SharedCacheAdapter;
  private readonly metrics: CacheMetrics;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly pendingLoads = new Map<
    string,
    Promise<CacheResult<unknown>>
  >();
  private readonly localGenerations = new Map<string, number>();

  constructor(options: CacheServiceOptions = {}) {
    this.memory = options.memory ?? new MemoryCacheAdapter();
    this.shared = options.shared ?? unavailableSharedCache;
    this.metrics = options.metrics ?? cacheMetrics;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async getOrLoad<T>(
    policy: CachePolicy,
    params: unknown,
    loader: () => Promise<T>,
    options: CacheLoadOptions<T> = {},
  ): Promise<T> {
    return (await this.getOrLoadResult(policy, params, loader, options)).value;
  }

  /**
   * Reads an existing cache entry without invoking a loader or scheduling a
   * refresh. This is useful for latency-sensitive routes that must never make
   * an end user wait for an expensive origin refresh.
   */
  async getCachedResult<T>(
    policy: CachePolicy,
    params: unknown,
    options: Pick<CacheLoadOptions<T>, 'scope'> = {},
  ): Promise<CacheResult<T> | null> {
    this.validateScope(policy, options.scope);
    const generation = await this.getGeneration(policy.namespace);
    const key = buildCacheKey(policy, params, {
      scope: options.scope,
      generation,
    });
    const now = this.now();

    if (policy.layers.includes('memory')) {
      const entry = this.memory.get<T>(key, now);
      if (entry) {
        const status = entry.freshUntil > now ? 'HIT' : 'STALE';
        this.metrics.recordRead(policy.namespace, status);
        return this.result(key, policy, entry, 'L1', status, now);
      }
    }

    if (policy.layers.includes('shared')) {
      try {
        const entry = await this.shared.get<T>(key);
        if (entry && entry.staleUntil > now) {
          if (policy.layers.includes('memory')) this.memory.set(key, entry);
          const status = entry.freshUntil > now ? 'HIT' : 'STALE';
          this.metrics.recordRead(policy.namespace, status);
          return this.result(key, policy, entry, 'L2', status, now);
        }
      } catch {
        this.metrics.recordError(policy.namespace);
      }
    }

    this.metrics.recordRead(policy.namespace, 'MISS');
    return null;
  }

  async getOrLoadResult<T>(
    policy: CachePolicy,
    params: unknown,
    loader: () => Promise<T>,
    options: CacheLoadOptions<T> = {},
  ): Promise<CacheResult<T>> {
    this.validateScope(policy, options.scope);
    const generation = await this.getGeneration(policy.namespace);
    const key = buildCacheKey(policy, params, {
      scope: options.scope,
      generation,
    });
    const now = this.now();
    let staleCandidate: StaleCandidate<T> | null = null;

    if (policy.layers.includes('memory')) {
      const entry = this.memory.get<T>(key, now);
      if (entry) {
        if (entry.freshUntil > now && !options.forceRefresh) {
          this.metrics.recordRead(policy.namespace, 'HIT');
          return this.result(key, policy, entry, 'L1', 'HIT', now);
        }
        staleCandidate = { entry, layer: 'L1' };
        if (!options.forceRefresh) {
          this.metrics.recordRead(policy.namespace, 'STALE');
          this.scheduleRefresh(key, policy, loader, options, staleCandidate);
          return this.result(key, policy, entry, 'L1', 'STALE', now);
        }
      }
    }

    if (policy.layers.includes('shared')) {
      try {
        const entry = await this.shared.get<T>(key);
        if (entry && entry.staleUntil > now) {
          if (entry.freshUntil > now && !options.forceRefresh) {
            if (policy.layers.includes('memory')) this.memory.set(key, entry);
            this.metrics.recordRead(policy.namespace, 'HIT');
            return this.result(key, policy, entry, 'L2', 'HIT', now);
          }
          staleCandidate = this.newerStaleCandidate(staleCandidate, {
            entry,
            layer: 'L2',
          });
          if (
            staleCandidate.layer === 'L2' &&
            policy.layers.includes('memory')
          ) {
            this.memory.set(key, entry);
          }
          if (!options.forceRefresh) {
            this.metrics.recordRead(policy.namespace, 'STALE');
            this.scheduleRefresh(key, policy, loader, options, staleCandidate);
            return this.result(key, policy, entry, 'L2', 'STALE', now);
          }
        }
      } catch {
        this.metrics.recordError(policy.namespace);
      }
    }

    this.metrics.recordRead(policy.namespace, 'MISS');
    return this.singleFlight(key, policy, () =>
      this.loadAndStore(key, policy, loader, options, staleCandidate),
    );
  }

  async set<T>(
    policy: CachePolicy,
    params: unknown,
    value: T,
    options: CacheLoadOptions<T> = {},
  ): Promise<boolean> {
    this.validateScope(policy, options.scope);
    const generation = await this.getGeneration(policy.namespace);
    const key = buildCacheKey(policy, params, {
      scope: options.scope,
      generation,
    });
    return Boolean(await this.store(key, policy, value, options));
  }

  async delete(
    policy: CachePolicy,
    params: unknown,
    scope?: string,
  ): Promise<number> {
    this.validateScope(policy, scope);
    const generation = await this.getGeneration(policy.namespace);
    const key = buildCacheKey(policy, params, { scope, generation });
    const local = this.memory.delete(key) ? 1 : 0;
    if (!policy.layers.includes('shared')) return local;
    try {
      return local + (await this.shared.delete(key));
    } catch {
      this.metrics.recordError(policy.namespace);
      return local;
    }
  }

  async invalidateNamespace(
    policyOrNamespace: CachePolicy | string,
  ): Promise<CacheInvalidationResult> {
    const namespace =
      typeof policyOrNamespace === 'string'
        ? policyOrNamespace
        : policyOrNamespace.namespace;
    const current = this.localGenerations.get(namespace) || 1;
    let generation = current + 1;
    let shared = false;

    try {
      if (this.shared.isAvailable()) {
        generation = await this.shared.incrementGeneration(
          namespace,
          current + 1,
        );
        shared = true;
      }
    } catch {
      this.metrics.recordError(namespace);
    }

    generation = this.rememberGeneration(namespace, generation);
    const localEntriesRemoved = this.memory.deleteNamespace(namespace);
    return { namespace, generation, localEntriesRemoved, shared };
  }

  async invalidateTag(tag: string): Promise<CacheInvalidationResult[]> {
    return Promise.all(
      getPoliciesByTag(tag).map((policy) =>
        this.invalidateNamespace(policy.namespace),
      ),
    );
  }

  async invalidateTags(tags: string[]): Promise<CacheInvalidationResult[]> {
    const namespaces = Array.from(
      new Set(
        tags.flatMap((tag) =>
          getPoliciesByTag(tag).map((policy) => policy.namespace),
        ),
      ),
    );
    return Promise.all(
      namespaces.map((namespace) => this.invalidateNamespace(namespace)),
    );
  }

  async invalidateAll(): Promise<CacheInvalidationResult[]> {
    const namespaces = Array.from(
      new Set(ALL_CACHE_POLICIES.map((policy) => policy.namespace)),
    );
    return Promise.all(
      namespaces.map((namespace) => this.invalidateNamespace(namespace)),
    );
  }

  async stats(): Promise<{
    namespaces: CacheNamespaceStats[];
    layers: CacheLayerStats[];
  }> {
    let sharedStats: CacheLayerStats = {
      layer: 'L2',
      entries: 0,
      estimatedBytes: 0,
    };
    try {
      sharedStats = await this.shared.stats();
    } catch {
      this.metrics.recordError('cache-system');
    }
    return {
      namespaces: this.metrics.snapshot(),
      layers: [this.memory.stats(this.now()), sharedStats],
    };
  }

  clearMemory(): number {
    return this.memory.clear();
  }

  clearExpiredMemory(): number {
    return this.memory.pruneExpired(this.now());
  }

  private async getGeneration(namespace: string): Promise<number> {
    try {
      if (this.shared.isAvailable()) {
        let sharedGeneration = await this.shared.getGeneration(namespace);
        const latestLocalGeneration = this.currentGeneration(namespace);
        if (latestLocalGeneration > sharedGeneration) {
          sharedGeneration = await this.shared.ensureGeneration(
            namespace,
            latestLocalGeneration,
          );
        }
        return this.rememberGeneration(namespace, sharedGeneration);
      }
    } catch {
      this.metrics.recordError(namespace);
    }
    return this.currentGeneration(namespace);
  }

  private currentGeneration(namespace: string): number {
    return this.localGenerations.get(namespace) || 1;
  }

  private rememberGeneration(namespace: string, candidate: number): number {
    const generation = Math.max(this.currentGeneration(namespace), candidate);
    this.localGenerations.set(namespace, generation);
    return generation;
  }

  private validateScope(policy: CachePolicy, scope?: string): void {
    if (policy.scope === 'user' && !scope) {
      throw new Error(`Cache policy ${policy.namespace} requires a user scope`);
    }
  }

  private result<T>(
    key: string,
    policy: CachePolicy,
    entry: CacheEntry<T>,
    layer: 'L1' | 'L2',
    status: 'HIT' | 'STALE',
    now: number,
  ): CacheResult<T> {
    return {
      value: entry.value,
      key,
      namespace: policy.namespace,
      layer,
      status,
      ttlRemaining: Math.max(0, Math.ceil((entry.freshUntil - now) / 1000)),
      negative: Boolean(entry.negative),
    };
  }

  private singleFlight<T>(
    key: string,
    policy: CachePolicy,
    load: () => Promise<CacheResult<T>>,
  ): Promise<CacheResult<T>> {
    const pending = this.pendingLoads.get(key);
    if (pending) {
      this.metrics.recordCoalescedLoad(policy.namespace);
      return pending as Promise<CacheResult<T>>;
    }

    const promise = load().finally(() => this.pendingLoads.delete(key));
    this.pendingLoads.set(key, promise as Promise<CacheResult<unknown>>);
    return promise;
  }

  private scheduleRefresh<T>(
    key: string,
    policy: CachePolicy,
    loader: () => Promise<T>,
    options: CacheLoadOptions<T>,
    staleCandidate: StaleCandidate<T>,
  ): void {
    void this.singleFlight(key, policy, () =>
      this.loadAndStore(key, policy, loader, options, staleCandidate),
    ).catch(() => {
      // The caller already received a valid stale value.
    });
  }

  private async loadAndStore<T>(
    key: string,
    policy: CachePolicy,
    loader: () => Promise<T>,
    options: CacheLoadOptions<T>,
    staleCandidate: StaleCandidate<T> | null,
  ): Promise<CacheResult<T>> {
    try {
      const value = await loader();
      if (options.validate && !options.validate(value)) {
        throw new Error(`Loader returned invalid data for ${policy.namespace}`);
      }
      const now = this.now();
      const entry = await this.store(key, policy, value, options, now);
      return {
        value,
        key,
        namespace: policy.namespace,
        layer: 'ORIGIN',
        status: 'MISS',
        ttlRemaining: entry
          ? Math.max(0, Math.ceil((entry.freshUntil - now) / 1000))
          : 0,
        negative: Boolean(entry?.negative),
      };
    } catch (error) {
      this.metrics.recordError(policy.namespace);
      if (staleCandidate && staleCandidate.entry.staleUntil > this.now()) {
        return this.result(
          key,
          policy,
          staleCandidate.entry,
          staleCandidate.layer,
          'STALE',
          this.now(),
        );
      }
      throw error;
    }
  }

  private newerStaleCandidate<T>(
    current: StaleCandidate<T> | null,
    candidate: StaleCandidate<T>,
  ): StaleCandidate<T> {
    if (!current) return candidate;
    return candidate.entry.createdAt > current.entry.createdAt
      ? candidate
      : current;
  }

  private async store<T>(
    key: string,
    policy: CachePolicy,
    value: T,
    options: CacheLoadOptions<T>,
    now = this.now(),
  ): Promise<CacheEntry<T> | null> {
    const bytes = estimateValueBytes(value);
    if (policy.maxEntryBytes && bytes > policy.maxEntryBytes) {
      this.metrics.recordRejectedWrite(policy.namespace);
      return null;
    }

    const entry = this.createEntry(policy, value, options, now);
    if (policy.layers.includes('memory')) this.memory.set(key, entry, bytes);
    if (policy.layers.includes('shared')) {
      const ttlSeconds = Math.max(
        1,
        Math.ceil((entry.staleUntil - now) / 1000),
      );
      try {
        await this.shared.set(key, entry, ttlSeconds);
      } catch {
        this.metrics.recordError(policy.namespace);
      }
    }
    this.metrics.recordWrite(policy.namespace, bytes);
    return entry;
  }

  private createEntry<T>(
    policy: CachePolicy,
    value: T,
    options: CacheLoadOptions<T>,
    now: number,
  ): CacheEntry<T> {
    const negative = options.isNegative
      ? options.isNegative(value)
      : value === null || (Array.isArray(value) && value.length === 0);
    const baseFreshTtl =
      negative && policy.negativeTtlSeconds
        ? policy.negativeTtlSeconds
        : policy.freshTtlSeconds;
    const jitterRatio = Math.max(0, Math.min(policy.jitterRatio || 0, 0.5));
    const freshTtl = Math.max(
      1,
      Math.floor(baseFreshTtl * (1 - this.random() * jitterRatio)),
    );
    const staleTtl = negative ? 0 : policy.staleTtlSeconds || 0;
    const freshUntil = now + freshTtl * 1000;

    return {
      schemaVersion: 1,
      value,
      createdAt: now,
      freshUntil,
      staleUntil: freshUntil + staleTtl * 1000,
      sourceVersion: options.sourceVersion,
      negative,
    };
  }
}

function estimateValueBytes(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return Buffer.byteLength(JSON.stringify(value));
}

const unavailableSharedCache: SharedCacheAdapter = {
  isAvailable: () => false,
  get: async () => null,
  set: async () => undefined,
  delete: async () => 0,
  getGeneration: async () => 1,
  ensureGeneration: async (_namespace, minimumGeneration) => minimumGeneration,
  incrementGeneration: async () => 1,
  stats: async () => ({ layer: 'L2', entries: 0, estimatedBytes: 0 }),
};
