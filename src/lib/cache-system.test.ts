import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MemoryCacheAdapter } from './cache-system/adapters/memory.ts';
import {
  noStoreResponseHeaders,
  publicApiResponseHeaders,
  STATIC_MEDIA_TTL_SECONDS,
  staticMediaResponseHeaders,
} from './cache-system/http.ts';
import {
  buildCacheKey,
  hasOnlyUniqueSearchParams,
  stableSerialize,
} from './cache-system/keys.ts';
import { DiskMediaCache } from './cache-system/media/disk.ts';
import {
  hasFailedPreconditions,
  hasSensitiveMediaParams,
  isAllowedMediaContentType,
  isIfRangeMatch,
  isNotModified,
  parseSingleRange,
  readBodyWithLimit,
} from './cache-system/media/policy.ts';
import { CacheMetrics } from './cache-system/metrics.ts';
import { CacheService } from './cache-system/server.ts';
import type {
  CacheEntry,
  CacheLayerStats,
  CachePolicy,
  SharedCacheAdapter,
} from './cache-system/types.ts';

const basePolicy: CachePolicy = {
  namespace: 'test.values',
  version: 1,
  scope: 'public',
  freshTtlSeconds: 10,
  staleTtlSeconds: 20,
  negativeTtlSeconds: 2,
  jitterRatio: 0,
  layers: ['memory', 'shared'],
  maxEntryBytes: 1024,
  tags: ['test'],
  cacheErrors: false,
};

class FakeSharedCache implements SharedCacheAdapter {
  readonly entries = new Map<string, CacheEntry<unknown>>();
  readonly generations = new Map<string, number>();
  available = true;
  fail = false;

  isAvailable(): boolean {
    return this.available;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (this.fail) throw new Error('shared unavailable');
    return (this.entries.get(key) as CacheEntry<T> | undefined) || null;
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    if (this.fail) throw new Error('shared unavailable');
    this.entries.set(key, entry as CacheEntry<unknown>);
  }

  async delete(key: string): Promise<number> {
    return this.entries.delete(key) ? 1 : 0;
  }

  async getGeneration(namespace: string): Promise<number> {
    if (this.fail) throw new Error('shared unavailable');
    return this.generations.get(namespace) || 1;
  }

  async ensureGeneration(
    namespace: string,
    minimumGeneration: number,
  ): Promise<number> {
    if (this.fail) throw new Error('shared unavailable');
    const generation = Math.max(
      this.generations.get(namespace) || 1,
      minimumGeneration,
    );
    this.generations.set(namespace, generation);
    return generation;
  }

  async incrementGeneration(
    namespace: string,
    minimumGeneration = 2,
  ): Promise<number> {
    if (this.fail) throw new Error('shared unavailable');
    const next = Math.max(
      (this.generations.get(namespace) || 1) + 1,
      minimumGeneration,
    );
    this.generations.set(namespace, next);
    return next;
  }

  async stats(): Promise<CacheLayerStats> {
    return {
      layer: 'L2',
      entries: this.entries.size,
      estimatedBytes: 0,
    };
  }
}

function service(options?: {
  shared?: FakeSharedCache;
  now?: () => number;
  random?: () => number;
  memory?: MemoryCacheAdapter;
}) {
  return new CacheService({
    shared: options?.shared || new FakeSharedCache(),
    memory: options?.memory,
    metrics: new CacheMetrics(),
    now: options?.now,
    random: options?.random,
  });
}

test('stable cache keys ignore object order and preserve Unicode', () => {
  assert.equal(
    stableSerialize({ text: '中文', nested: { b: 2, a: 1 } }),
    stableSerialize({ nested: { a: 1, b: 2 }, text: '中文' }),
  );
  assert.equal(
    buildCacheKey(basePolicy, { text: '中文', page: 1 }),
    buildCacheKey(basePolicy, { page: 1, text: '中文' }),
  );
});

test('shared HTTP cache parameters reject unknown and duplicate names', () => {
  assert.equal(
    hasOnlyUniqueSearchParams(new URLSearchParams('q=test&page=1'), [
      'q',
      'page',
    ]),
    true,
  );
  assert.equal(
    hasOnlyUniqueSearchParams(new URLSearchParams('q=test&debug=1'), ['q']),
    false,
  );
  assert.equal(
    hasOnlyUniqueSearchParams(new URLSearchParams('q=first&q=second'), ['q']),
    false,
  );
});

test('user cache keys isolate scope and reject a missing scope', () => {
  const policy = { ...basePolicy, scope: 'user' as const };
  assert.notEqual(
    buildCacheKey(policy, { page: 1 }, { scope: 'user-a' }),
    buildCacheKey(policy, { page: 1 }, { scope: 'user-b' }),
  );
  assert.throws(() => buildCacheKey(policy, { page: 1 }));
});

test('bounded memory cache evicts by LRU order and bytes', () => {
  const memory = new MemoryCacheAdapter({ maxEntries: 2, maxBytes: 12 });
  const entry = (value: string): CacheEntry<string> => ({
    schemaVersion: 1,
    value,
    createdAt: 0,
    freshUntil: 100,
    staleUntil: 100,
  });
  memory.set('one', entry('1'), 4);
  memory.set('two', entry('2'), 4);
  assert.equal(memory.get('one', 1)?.value, '1');
  memory.set('three', entry('3'), 4);
  assert.equal(memory.get('two', 1), null);
  assert.equal(memory.get('one', 1)?.value, '1');
  assert.equal(memory.get('three', 1)?.value, '3');
  memory.set('large', entry('large'), 9);
  assert.equal(memory.stats().estimatedBytes <= 12, true);
});

test('same-key concurrent misses execute one loader', async () => {
  const cache = service();
  let loads = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loader = async () => {
    loads++;
    await gate;
    return { ok: true };
  };
  const pending = Array.from({ length: 100 }, () =>
    cache.getOrLoad(basePolicy, { id: 1 }, loader),
  );
  release?.();
  const values = await Promise.all(pending);
  assert.equal(loads, 1);
  assert.equal(
    values.every((value) => value.ok),
    true,
  );
});

test('cache-only reads never invoke a loader and preserve stale values', async () => {
  let now = 1_000;
  const cache = service({ now: () => now, random: () => 0 });
  const params = { id: 'cached-only' };

  assert.equal(await cache.getCachedResult(basePolicy, params), null);
  await cache.set(basePolicy, params, { ok: true });

  const fresh = await cache.getCachedResult<{ ok: boolean }>(
    basePolicy,
    params,
  );
  assert.equal(fresh?.status, 'HIT');
  assert.deepEqual(fresh?.value, { ok: true });

  now += 11_000;
  const stale = await cache.getCachedResult<{ ok: boolean }>(
    basePolicy,
    params,
  );
  assert.equal(stale?.status, 'STALE');
  assert.deepEqual(stale?.value, { ok: true });
});

test('generation invalidation changes the key on its first increment', async () => {
  const shared = new FakeSharedCache();
  const cache = service({ shared });
  let loads = 0;
  await cache.getOrLoad(basePolicy, { id: 1 }, async () => ++loads);
  await cache.getOrLoad(basePolicy, { id: 1 }, async () => ++loads);
  assert.equal(loads, 1);
  const invalidation = await cache.invalidateNamespace(basePolicy);
  assert.equal(invalidation.generation, 2);
  await cache.getOrLoad(basePolicy, { id: 1 }, async () => ++loads);
  assert.equal(loads, 2);
  assert.equal(
    Array.from(shared.entries.keys()).some((key) => key.includes(':g2:')),
    true,
  );
});

test('a local invalidation cannot roll back after shared cache recovery', async () => {
  const shared = new FakeSharedCache();
  const cache = service({ shared });
  let loads = 0;
  assert.equal(
    await cache.getOrLoad(basePolicy, { id: 1 }, async () => ++loads),
    1,
  );

  shared.available = false;
  const invalidation = await cache.invalidateNamespace(basePolicy);
  assert.equal(invalidation.generation, 2);
  shared.available = true;

  assert.equal(
    await cache.getOrLoad(basePolicy, { id: 1 }, async () => ++loads),
    2,
  );
  assert.equal(shared.generations.get(basePolicy.namespace), 2);
});

test('an in-flight generation read cannot undo a concurrent invalidation', async () => {
  let releaseRead: (() => void) | undefined;
  let markReadStarted: (() => void) | undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });

  class RacingSharedCache extends FakeSharedCache {
    override async getGeneration(namespace: string): Promise<number> {
      const generation = await super.getGeneration(namespace);
      markReadStarted?.();
      await readGate;
      return generation;
    }
  }

  const shared = new RacingSharedCache();
  const cache = service({ shared });
  const pendingRead = cache.getOrLoad(basePolicy, { id: 1 }, async () => 1);
  await readStarted;
  const invalidation = await cache.invalidateNamespace(basePolicy);
  assert.equal(invalidation.generation, 2);
  releaseRead?.();

  assert.equal(await pendingRead, 1);
  assert.equal(
    Array.from(shared.entries.keys()).every((key) => key.includes(':g2:')),
    true,
  );
});

test('TTL boundaries, stale-if-error and negative caching are deterministic', async () => {
  let now = 0;
  const cache = service({ now: () => now, random: () => 0 });
  let loads = 0;
  const loader = async () => ++loads;
  assert.equal(await cache.getOrLoad(basePolicy, { id: 1 }, loader), 1);
  now = 9_999;
  assert.equal(await cache.getOrLoad(basePolicy, { id: 1 }, loader), 1);
  now = 10_000;
  assert.equal(
    await cache.getOrLoad(
      basePolicy,
      { id: 1 },
      async () => {
        throw new Error('origin down');
      },
      { forceRefresh: true },
    ),
    1,
  );
  now = 30_000;
  await assert.rejects(
    cache.getOrLoad(
      basePolicy,
      { id: 1 },
      async () => {
        throw new Error('origin down');
      },
      { forceRefresh: true },
    ),
  );

  now = 0;
  let negativeLoads = 0;
  const negative = await cache.getOrLoadResult(
    basePolicy,
    { id: 2 },
    async () => {
      negativeLoads++;
      return null;
    },
  );
  assert.equal(negative.value, null);
  assert.equal(negative.negative, true);
  now = 1_999;
  await cache.getOrLoad(basePolicy, { id: 2 }, async () => {
    negativeLoads++;
    return null;
  });
  assert.equal(negativeLoads, 1);
  now = 2_000;
  await cache.getOrLoad(basePolicy, { id: 2 }, async () => {
    negativeLoads++;
    return null;
  });
  assert.equal(negativeLoads, 2);
});

test('force refresh preserves the newest stale candidate across L1 and L2', async () => {
  let now = 0;
  const shared = new FakeSharedCache();
  const cache = service({ shared, now: () => now, random: () => 0 });
  assert.equal(
    await cache.getOrLoad(basePolicy, { id: 1 }, async () => 'old'),
    'old',
  );

  now = 1_000;
  shared.fail = true;
  assert.equal(await cache.set(basePolicy, { id: 1 }, 'new'), true);
  shared.fail = false;

  const result = await cache.getOrLoadResult(
    basePolicy,
    { id: 1 },
    async () => {
      throw new Error('origin unavailable');
    },
    { forceRefresh: true },
  );
  assert.equal(result.value, 'new');
  assert.equal(result.status, 'STALE');
  assert.equal(result.layer, 'L1');
  assert.equal(
    await cache.getOrLoad(basePolicy, { id: 1 }, async () => 'unexpected'),
    'new',
  );
});

test('TTL jitter stays inside the policy range', async () => {
  const policy = {
    ...basePolicy,
    freshTtlSeconds: 100,
    staleTtlSeconds: 0,
    jitterRatio: 0.1,
  };
  const minimum = await service({ now: () => 0, random: () => 1 })
    .getOrLoadResult(policy, {}, async () => true)
    .then((result) => result.ttlRemaining);
  const maximum = await service({ now: () => 0, random: () => 0 })
    .getOrLoadResult(policy, {}, async () => true)
    .then((result) => result.ttlRemaining);
  assert.equal(minimum, 90);
  assert.equal(maximum, 100);
});

test('shared cache failure fails open to the business loader', async () => {
  const shared = new FakeSharedCache();
  shared.fail = true;
  const value = await service({ shared }).getOrLoad(
    basePolicy,
    { id: 1 },
    async () => 'origin',
  );
  assert.equal(value, 'origin');
});

test('HTTP helpers enforce private errors, shared policy and one-week media', () => {
  assert.equal(
    noStoreResponseHeaders().get('cache-control'),
    'private, no-store, max-age=0',
  );
  assert.match(
    publicApiResponseHeaders({
      ...basePolicy,
      layers: ['memory', 'shared', 'cdn'],
    }).get('cache-control') || '',
    /s-maxage=10/,
  );
  assert.match(
    publicApiResponseHeaders(
      { ...basePolicy, layers: ['memory', 'shared', 'cdn'] },
      { ttlSeconds: 3 },
    ).get('cache-control') || '',
    /s-maxage=3/,
  );
  assert.equal(
    publicApiResponseHeaders(
      { ...basePolicy, layers: ['memory', 'shared', 'cdn'] },
      { ttlSeconds: 0 },
    ).get('cache-control'),
    'public, max-age=0, s-maxage=0, stale-while-revalidate=0',
  );
  assert.equal(
    publicApiResponseHeaders(
      { ...basePolicy, layers: ['memory', 'shared', 'cdn'] },
      { ttlSeconds: 2, negative: true },
    ).get('cache-control'),
    'public, max-age=0, s-maxage=2, stale-while-revalidate=0',
  );
  assert.equal(STATIC_MEDIA_TTL_SECONDS, 604_800);
  assert.equal(
    staticMediaResponseHeaders().get('cache-control'),
    'public, max-age=604800, s-maxage=604800',
  );
  assert.equal(
    staticMediaResponseHeaders({ ttlSeconds: 42 }).get('cache-control'),
    'public, max-age=42, s-maxage=42',
  );
});

test('media policy validates content, ranges and signed URLs', () => {
  assert.equal(isAllowedMediaContentType('image', 'image/webp'), true);
  assert.equal(isAllowedMediaContentType('image', 'text/html'), false);
  assert.deepEqual(parseSingleRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseSingleRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseSingleRange('bytes=20-30', 10), 'invalid');
  assert.equal(
    hasSensitiveMediaParams('https://cdn.example/a.mp4?token=secret'),
    true,
  );
  assert.equal(
    hasSensitiveMediaParams('https://cdn.example/a.mp4?v=content-hash'),
    false,
  );
  assert.equal(
    isNotModified(
      new Request('https://app.example/media', {
        headers: { 'If-None-Match': 'W/"media-etag"' },
      }),
      { etag: '"media-etag"' },
    ),
    true,
  );
  assert.equal(
    isNotModified(
      new Request('https://app.example/media', {
        headers: { 'If-None-Match': '*' },
      }),
      {},
    ),
    true,
  );
  assert.equal(
    hasFailedPreconditions(
      new Request('https://app.example/media', {
        headers: { 'If-Match': '"different"' },
      }),
      { etag: '"media-etag"' },
    ),
    true,
  );
  assert.equal(
    hasFailedPreconditions(
      new Request('https://app.example/media', {
        headers: { 'If-Match': 'W/"media-etag"' },
      }),
      { etag: '"media-etag"' },
    ),
    true,
  );
  assert.equal(
    isIfRangeMatch(
      new Request('https://app.example/media', {
        headers: { 'If-Range': '"media-etag"' },
      }),
      { etag: '"media-etag"' },
    ),
    true,
  );
  assert.equal(
    isIfRangeMatch(
      new Request('https://app.example/media', {
        headers: { 'If-Range': 'W/"media-etag"' },
      }),
      { etag: '"media-etag"' },
    ),
    false,
  );
});

test('bounded media reads stop responses without a trustworthy length', async () => {
  assert.deepEqual(
    await readBodyWithLimit(new Response(new Uint8Array([1, 2, 3])), 3),
    new Uint8Array([1, 2, 3]),
  );
  await assert.rejects(
    readBodyWithLimit(new Response(new Uint8Array([1, 2, 3])), 2),
    RangeError,
  );
});

test('disk cleanup counts valid bytes independently from orphan files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dong-media-quota-test-'));
  const writer = new DiskMediaCache({
    rootDir: root,
    kind: 'image',
    maxBytes: 1024,
    maxEntryBytes: 512,
    now: () => 0,
  });
  try {
    await writer.getOrCreate(
      'https://one.example/a.jpg',
      'original',
      async () => ({
        data: new Uint8Array([1, 2, 3]),
        contentType: 'image/jpeg',
      }),
    );
    await writer.getOrCreate(
      'https://two.example/b.jpg',
      'original',
      async () => ({
        data: new Uint8Array([4, 5, 6]),
        contentType: 'image/jpeg',
      }),
    );
    await writeFile(path.join(root, `${'a'.repeat(64)}.bin`), 'orphan');

    const quotaCache = new DiskMediaCache({
      rootDir: root,
      kind: 'image',
      maxBytes: 5,
      lowWaterRatio: 0.8,
      maxEntryBytes: 512,
      now: () => 0,
    });
    const cleanup = await quotaCache.cleanup();
    assert.equal(cleanup.removed, 2);
    assert.equal(cleanup.bytes, 3);
    assert.equal((await quotaCache.stats()).entries, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('disk media cache isolates full URLs and removes expired objects', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dong-media-cache-test-'));
  let now = 0;
  const cache = new DiskMediaCache({
    rootDir: root,
    kind: 'image',
    maxBytes: 1024,
    maxEntryBytes: 512,
    now: () => now,
  });
  try {
    const first = await cache.getOrCreate(
      'https://one.example/poster.jpg',
      'original',
      async () => ({
        data: new Uint8Array([1, 2, 3]),
        contentType: 'image/jpeg',
      }),
    );
    const second = await cache.getOrCreate(
      'https://two.example/poster.jpg',
      'original',
      async () => ({
        data: new Uint8Array([4, 5, 6]),
        contentType: 'image/jpeg',
      }),
    );
    assert.notEqual(first.metadata.key, second.metadata.key);
    assert.equal((await cache.stats()).entries, 2);
    now = 604_800_001;
    const cleanup = await cache.cleanup();
    assert.equal(cleanup.removed, 2);
    assert.equal((await cache.stats()).entries, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
