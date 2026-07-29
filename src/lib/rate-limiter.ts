import { hashCacheValue } from '@/lib/cache-system/keys';
import { db } from '@/lib/db';

interface LocalCounter {
  count: number;
  expiresAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly local = new Map<string, LocalCounter>();

  constructor(private readonly maxLocalEntries = 2_000) {}

  async consume(
    namespace: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const key = `dm:rate-limit:${namespace}:${hashCacheValue(subject).slice(0, 32)}`;
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'redis' || storageType === 'kvrocks') {
      try {
        const client = db.getClient();
        const result = (await client.eval(
          `local current = redis.call('INCR', KEYS[1])
           local existingTtl = redis.call('TTL', KEYS[1])
           if current == 1 or existingTtl < 0 then
             redis.call('EXPIRE', KEYS[1], ARGV[1])
           end
           local ttl = redis.call('TTL', KEYS[1])
           return {current, ttl}`,
          { keys: [key], arguments: [String(windowSeconds)] },
        )) as [number, number];
        return this.toResult(result[0], limit, result[1]);
      } catch {
        // Cache/storage availability must not become route availability.
      }
    }
    return this.consumeLocal(key, limit, windowSeconds);
  }

  private consumeLocal(
    key: string,
    limit: number,
    windowSeconds: number,
  ): RateLimitResult {
    const now = Date.now();
    let counter = this.local.get(key);
    if (!counter || counter.expiresAt <= now) {
      counter = { count: 0, expiresAt: now + windowSeconds * 1_000 };
    }
    counter.count++;
    this.local.delete(key);
    this.local.set(key, counter);
    this.evict(now);
    return this.toResult(
      counter.count,
      limit,
      Math.ceil((counter.expiresAt - now) / 1_000),
    );
  }

  private toResult(
    count: number,
    limit: number,
    retryAfterSeconds: number,
  ): RateLimitResult {
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  private evict(now: number): void {
    for (const [key, value] of this.local) {
      if (value.expiresAt <= now) this.local.delete(key);
    }
    while (this.local.size > this.maxLocalEntries) {
      const oldest = this.local.keys().next().value as string | undefined;
      if (!oldest) break;
      this.local.delete(oldest);
    }
  }
}

export const rateLimiter = new RateLimiter();
