import type { CacheEntry, CacheLayerStats } from '../types.ts';

interface MemoryRecord {
  entry: CacheEntry<unknown>;
  bytes: number;
  lastAccessAt: number;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export class MemoryCacheAdapter {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 500;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  }

  get<T>(key: string, now = Date.now()): CacheEntry<T> | null {
    const record = this.records.get(key);
    if (!record) return null;
    if (record.entry.staleUntil <= now) {
      this.remove(key);
      return null;
    }

    record.lastAccessAt = now;
    this.records.delete(key);
    this.records.set(key, record);
    return record.entry as CacheEntry<T>;
  }

  set<T>(key: string, entry: CacheEntry<T>, bytes?: number): boolean {
    const entryBytes = bytes ?? Buffer.byteLength(JSON.stringify(entry));
    if (entryBytes > this.maxBytes) return false;

    this.remove(key);
    this.records.set(key, {
      entry: entry as CacheEntry<unknown>,
      bytes: entryBytes,
      lastAccessAt: Date.now(),
    });
    this.totalBytes += entryBytes;
    this.evict();
    return this.records.has(key);
  }

  delete(key: string): boolean {
    return this.remove(key);
  }

  deleteNamespace(namespace: string): number {
    const marker = `:${namespace}:`;
    let removed = 0;
    for (const key of this.records.keys()) {
      if (key.includes(marker) && this.remove(key)) removed++;
    }
    return removed;
  }

  clear(): number {
    const count = this.records.size;
    this.records.clear();
    this.totalBytes = 0;
    return count;
  }

  pruneExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.entry.staleUntil <= now && this.remove(key)) removed++;
    }
    return removed;
  }

  stats(now = Date.now()): CacheLayerStats {
    let oldestCreatedAt: number | undefined;
    let newestAccessAt: number | undefined;
    let expiredEntries = 0;
    const byNamespace: Record<
      string,
      { entries: number; estimatedBytes: number }
    > = {};

    for (const [key, record] of this.records) {
      oldestCreatedAt =
        oldestCreatedAt === undefined
          ? record.entry.createdAt
          : Math.min(oldestCreatedAt, record.entry.createdAt);
      newestAccessAt =
        newestAccessAt === undefined
          ? record.lastAccessAt
          : Math.max(newestAccessAt, record.lastAccessAt);
      if (record.entry.staleUntil <= now) expiredEntries++;
      const namespace = key.split(':')[3] || 'unknown';
      const namespaceStats = (byNamespace[namespace] ||= {
        entries: 0,
        estimatedBytes: 0,
      });
      namespaceStats.entries++;
      namespaceStats.estimatedBytes += record.bytes;
    }

    return {
      layer: 'L1',
      entries: this.records.size,
      estimatedBytes: this.totalBytes,
      oldestCreatedAt,
      newestAccessAt,
      expiredEntries,
      byNamespace,
    };
  }

  private remove(key: string): boolean {
    const existing = this.records.get(key);
    if (!existing) return false;
    this.records.delete(key);
    this.totalBytes -= existing.bytes;
    return true;
  }

  private evict(): void {
    while (
      this.records.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldestKey = this.records.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.remove(oldestKey);
    }
  }
}
