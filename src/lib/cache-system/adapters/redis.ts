import { buildGenerationKey, getCacheEnvironmentName } from '../keys';
import type { CacheEntry, CacheLayerStats, SharedCacheAdapter } from '../types';
import { db } from '../../db';

interface CacheRedisClient {
  get(key: string): Promise<unknown>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  scanIterator(options: {
    MATCH: string;
    COUNT: number;
  }): AsyncGenerator<string | string[]>;
}

export class RedisCacheAdapter implements SharedCacheAdapter {
  private client: CacheRedisClient | null | undefined;
  private readonly getRedisClient: () => CacheRedisClient | null;

  constructor(getRedisClient = defaultRedisClient) {
    this.getRedisClient = getRedisClient;
  }

  isAvailable(): boolean {
    return this.resolveClient() !== null;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const client = this.resolveClient();
    if (!client) return null;
    const value = await client.get(key);
    if (!value || typeof value !== 'string') return null;

    try {
      const entry = JSON.parse(value) as CacheEntry<T>;
      if (
        entry.schemaVersion !== 1 ||
        !Number.isFinite(entry.createdAt) ||
        !Number.isFinite(entry.freshUntil) ||
        !Number.isFinite(entry.staleUntil)
      ) {
        await client.del(key);
        return null;
      }
      return entry;
    } catch {
      await client.del(key);
      return null;
    }
  }

  async set<T>(
    key: string,
    entry: CacheEntry<T>,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.resolveClient();
    if (!client) return;
    await client.setEx(
      key,
      Math.max(1, Math.floor(ttlSeconds)),
      JSON.stringify(entry),
    );
  }

  async delete(key: string): Promise<number> {
    const client = this.resolveClient();
    if (!client) return 0;
    return client.del(key);
  }

  async getGeneration(namespace: string): Promise<number> {
    const client = this.resolveClient();
    if (!client) return 1;
    const value = await client.get(buildGenerationKey(namespace));
    const generation = Number(value);
    return Number.isSafeInteger(generation) && generation > 0 ? generation : 1;
  }

  async ensureGeneration(
    namespace: string,
    minimumGeneration: number,
  ): Promise<number> {
    const client = this.resolveClient();
    if (!client) return Math.max(1, Math.floor(minimumGeneration));
    const value = await client.eval(
      `local current = tonumber(redis.call('GET', KEYS[1]) or '1')
       local minimum = tonumber(ARGV[1]) or 1
       local next = math.max(current, minimum)
       if next ~= current then redis.call('SET', KEYS[1], tostring(next)) end
       return next`,
      {
        keys: [buildGenerationKey(namespace)],
        arguments: [String(Math.max(1, Math.floor(minimumGeneration)))],
      },
    );
    const generation = Number(value);
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('Redis returned an invalid cache generation');
    }
    return generation;
  }

  async incrementGeneration(
    namespace: string,
    minimumGeneration = 2,
  ): Promise<number> {
    const client = this.resolveClient();
    if (!client) return 1;
    const value = await client.eval(
      `local current = tonumber(redis.call('GET', KEYS[1]) or '1')
       local minimum = tonumber(ARGV[1]) or 2
       local next = math.max(current + 1, minimum)
       redis.call('SET', KEYS[1], tostring(next))
       return next`,
      {
        keys: [buildGenerationKey(namespace)],
        arguments: [String(Math.max(2, Math.floor(minimumGeneration)))],
      },
    );
    const generation = Number(value);
    if (!Number.isSafeInteger(generation) || generation < 2) {
      throw new Error('Redis returned an invalid cache generation');
    }
    return generation;
  }

  async stats(): Promise<CacheLayerStats> {
    const client = this.resolveClient();
    if (!client) return { layer: 'L2', entries: 0, estimatedBytes: 0 };

    let entries = 0;
    let estimatedBytes = 0;
    let oldestCreatedAt: number | undefined;
    const byNamespace: Record<
      string,
      { entries: number; estimatedBytes: number }
    > = {};
    for await (const key of client.scanIterator({
      MATCH: `dm:v2:${getCacheEnvironmentName()}:*`,
      COUNT: 200,
    })) {
      const keys = Array.isArray(key) ? key : [key];
      for (const item of keys) {
        entries++;
        const namespace = String(item).split(':')[3] || 'unknown';
        const namespaceStats = (byNamespace[namespace] ||= {
          entries: 0,
          estimatedBytes: 0,
        });
        namespaceStats.entries++;
        const value = await client.get(String(item));
        if (!value || typeof value !== 'string') continue;
        const bytes = Buffer.byteLength(value);
        estimatedBytes += bytes;
        namespaceStats.estimatedBytes += bytes;
        try {
          const createdAt = (JSON.parse(value) as CacheEntry<unknown>)
            .createdAt;
          if (Number.isFinite(createdAt)) {
            oldestCreatedAt =
              oldestCreatedAt === undefined
                ? createdAt
                : Math.min(oldestCreatedAt, createdAt);
          }
        } catch {
          // Invalid entries are ignored here and removed on normal reads.
        }
      }
    }

    return {
      layer: 'L2',
      entries,
      estimatedBytes,
      oldestCreatedAt,
      byNamespace,
    };
  }

  private resolveClient(): CacheRedisClient | null {
    if (this.client) return this.client;
    const client = this.getRedisClient();
    if (client) this.client = client;
    return client;
  }
}

function defaultRedisClient(): CacheRedisClient | null {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'redis' && storageType !== 'kvrocks') return null;
  try {
    return db.getClient();
  } catch {
    return null;
  }
}
