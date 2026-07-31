import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

import {
  createMediaEtag,
  isAllowedMediaContentType,
  MEDIA_TTL_MS,
  type MediaKind,
  normalizeMediaContentType,
} from './policy.ts';
import { normalizeSourceUrl } from '../keys.ts';

export interface MediaCacheMetadata {
  schemaVersion: 1;
  key: string;
  sourceHash: string;
  kind: MediaKind;
  variant: string;
  contentType: string;
  size: number;
  etag: string;
  upstreamEtag?: string;
  lastModified?: string;
  createdAt: number;
  lastAccessAt: number;
  expiresAt: number;
}

export interface MediaPayload {
  data: Uint8Array;
  contentType: string;
  etag?: string;
  lastModified?: string;
}

export interface MediaCacheObject {
  data: Buffer;
  metadata: MediaCacheMetadata;
  status: 'HIT' | 'MISS' | 'BYPASS';
}

export interface DiskMediaCacheOptions {
  rootDir: string;
  kind: MediaKind;
  maxBytes: number;
  lowWaterRatio?: number;
  maxEntryBytes: number;
  now?: () => number;
}

export interface DiskMediaCacheStats {
  kind: MediaKind;
  enabled: boolean;
  entries: number;
  bytes: number;
  expiredEntries: number;
  oldestCreatedAt?: number;
  newestAccessAt?: number;
}

export class DiskMediaCache {
  private readonly pending = new Map<string, Promise<MediaCacheObject>>();
  private readonly now: () => number;
  private readonly options: DiskMediaCacheOptions;
  private enabled: boolean | undefined;

  constructor(options: DiskMediaCacheOptions) {
    this.options = options;
    this.now = options.now || Date.now;
  }

  async getOrCreate(
    sourceUrl: string,
    variant: string,
    loader: () => Promise<MediaPayload>,
  ): Promise<MediaCacheObject> {
    const identity = this.identity(sourceUrl, variant);
    const hit = await this.getByIdentity(identity);
    if (hit) return hit;

    const pending = this.pending.get(identity.key);
    if (pending) return pending;
    const task = this.loadAndStore(identity, variant, loader).finally(() =>
      this.pending.delete(identity.key),
    );
    this.pending.set(identity.key, task);
    return task;
  }

  async get(
    sourceUrl: string,
    variant = 'original',
  ): Promise<MediaCacheObject | null> {
    return this.getByIdentity(this.identity(sourceUrl, variant));
  }

  async delete(sourceUrl: string, variant = 'original'): Promise<boolean> {
    const identity = this.identity(sourceUrl, variant);
    return this.remove(identity.key);
  }

  async clear(): Promise<number> {
    if (!(await this.ensureDirectory())) return 0;
    const files = await fs.readdir(this.options.rootDir).catch(() => []);
    const keys = new Set<string>();
    for (const file of files) {
      const match = /^([a-f\d]{64})\.(?:bin|json)$/.exec(file);
      if (match) keys.add(match[1]);
    }
    let removed = 0;
    for (const key of keys) if (await this.remove(key)) removed++;
    return removed;
  }

  async stats(): Promise<DiskMediaCacheStats> {
    const enabled = await this.ensureDirectory();
    const result: DiskMediaCacheStats = {
      kind: this.options.kind,
      enabled,
      entries: 0,
      bytes: 0,
      expiredEntries: 0,
    };
    if (!enabled) return result;

    const now = this.now();
    const files = await fs.readdir(this.options.rootDir).catch(() => []);
    for (const file of files) {
      if (!/^[a-f\d]{64}\.json$/.test(file)) continue;
      const metadata = await this.readMetadata(
        path.join(this.options.rootDir, file),
      );
      if (!metadata || metadata.key !== file.slice(0, -5)) continue;
      const stat = await fs.stat(this.dataPath(metadata.key)).catch(() => null);
      if (!stat || stat.size !== metadata.size) continue;
      result.entries++;
      result.bytes += metadata.size;
      if (metadata.expiresAt <= now) result.expiredEntries++;
      result.oldestCreatedAt =
        result.oldestCreatedAt === undefined
          ? metadata.createdAt
          : Math.min(result.oldestCreatedAt, metadata.createdAt);
      result.newestAccessAt =
        result.newestAccessAt === undefined
          ? metadata.lastAccessAt
          : Math.max(result.newestAccessAt, metadata.lastAccessAt);
    }
    return result;
  }

  async cleanup(): Promise<{ removed: number; bytes: number }> {
    if (!(await this.ensureDirectory())) return { removed: 0, bytes: 0 };
    const files = await fs.readdir(this.options.rootDir).catch(() => []);
    const entries: MediaCacheMetadata[] = [];
    const metadataKeys = new Set<string>();
    let removed = 0;
    let totalBytes = 0;
    const now = this.now();

    for (const file of files) {
      const filePath = path.join(this.options.rootDir, file);
      if (file.includes('.tmp-')) {
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat && now - stat.mtimeMs > 60 * 60 * 1_000) {
          await fs.unlink(filePath).catch(() => undefined);
          removed++;
        }
        continue;
      }
      if (!file.endsWith('.json')) continue;
      const metadata = await this.readMetadata(filePath);
      const fileKey = file.slice(0, -5);
      if (!metadata || metadata.key !== fileKey || metadata.expiresAt <= now) {
        if (await this.remove(file.slice(0, -5))) removed++;
        continue;
      }
      const dataPath = this.dataPath(metadata.key);
      const stat = await fs.stat(dataPath).catch(() => null);
      if (!stat || stat.size !== metadata.size) {
        if (await this.remove(metadata.key)) removed++;
        continue;
      }
      metadataKeys.add(metadata.key);
      entries.push(metadata);
      totalBytes += metadata.size;
    }

    for (const file of files) {
      const match = /^([a-f\d]{64})\.bin$/.exec(file);
      if (!match || metadataKeys.has(match[1])) continue;
      const orphanRemoved = await fs
        .unlink(path.join(this.options.rootDir, file))
        .then(
          () => true,
          () => false,
        );
      if (orphanRemoved) removed++;
    }

    if (totalBytes > this.options.maxBytes) {
      const target = Math.floor(
        this.options.maxBytes * (this.options.lowWaterRatio ?? 0.8),
      );
      entries.sort((left, right) => left.lastAccessAt - right.lastAccessAt);
      for (const metadata of entries) {
        if (totalBytes <= target) break;
        if (await this.remove(metadata.key)) {
          totalBytes -= metadata.size;
          removed++;
        }
      }
    }
    return { removed, bytes: totalBytes };
  }

  private async loadAndStore(
    identity: { key: string; sourceHash: string },
    variant: string,
    loader: () => Promise<MediaPayload>,
  ): Promise<MediaCacheObject> {
    const payload = await loader();
    const data = Buffer.from(payload.data);
    const now = this.now();
    const contentType = normalizeMediaContentType(payload.contentType);
    if (!isAllowedMediaContentType(this.options.kind, contentType)) {
      throw new TypeError(
        `Unsupported ${this.options.kind} cache content type: ${contentType || 'empty'}`,
      );
    }
    const metadata: MediaCacheMetadata = {
      schemaVersion: 1,
      key: identity.key,
      sourceHash: identity.sourceHash,
      kind: this.options.kind,
      variant,
      contentType,
      size: data.byteLength,
      etag: payload.etag || createMediaEtag(data),
      upstreamEtag: payload.etag,
      lastModified: payload.lastModified,
      createdAt: now,
      lastAccessAt: now,
      expiresAt: now + MEDIA_TTL_MS,
    };

    if (
      data.byteLength > this.options.maxEntryBytes ||
      !(await this.ensureDirectory())
    ) {
      return { data, metadata, status: 'BYPASS' };
    }

    const token = randomUUID();
    const dataTemp = `${this.dataPath(identity.key)}.tmp-${token}`;
    const metadataTemp = `${this.metadataPath(identity.key)}.tmp-${token}`;
    try {
      await fs.writeFile(dataTemp, data, { flag: 'wx' });
      await fs.writeFile(metadataTemp, JSON.stringify(metadata), {
        flag: 'wx',
      });
      await fs.rename(dataTemp, this.dataPath(identity.key));
      await fs.rename(metadataTemp, this.metadataPath(identity.key));
      await this.cleanup();
      return { data, metadata, status: 'MISS' };
    } catch {
      await Promise.all([
        fs.unlink(dataTemp).catch(() => undefined),
        fs.unlink(metadataTemp).catch(() => undefined),
      ]);
      return { data, metadata, status: 'BYPASS' };
    }
  }

  private async getByIdentity(identity: {
    key: string;
    sourceHash: string;
  }): Promise<MediaCacheObject | null> {
    if (!(await this.ensureDirectory())) return null;
    const metadata = await this.readMetadata(this.metadataPath(identity.key));
    if (
      !metadata ||
      metadata.key !== identity.key ||
      metadata.sourceHash !== identity.sourceHash ||
      metadata.expiresAt <= this.now()
    ) {
      await this.remove(identity.key);
      return null;
    }
    const data = await fs
      .readFile(this.dataPath(identity.key))
      .catch(() => null);
    if (!data || data.byteLength !== metadata.size) {
      await this.remove(identity.key);
      return null;
    }
    metadata.lastAccessAt = this.now();
    await this.atomicMetadataWrite(metadata).catch(() => undefined);
    return { data, metadata, status: 'HIT' };
  }

  private identity(sourceUrl: string, variant: string) {
    const normalized = normalizeSourceUrl(sourceUrl);
    const sourceHash = createHash('sha256').update(normalized).digest('hex');
    const key = createHash('sha256')
      .update(`${this.options.kind}\0${variant}\0${normalized}`)
      .digest('hex');
    return { key, sourceHash };
  }

  private async readMetadata(filePath: string) {
    try {
      const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (
        value.schemaVersion !== 1 ||
        value.kind !== this.options.kind ||
        typeof value.key !== 'string' ||
        !/^[a-f\d]{64}$/.test(value.key) ||
        typeof value.sourceHash !== 'string' ||
        !/^[a-f\d]{64}$/.test(value.sourceHash) ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0 ||
        !Number.isFinite(value.createdAt) ||
        !Number.isFinite(value.lastAccessAt) ||
        !Number.isFinite(value.expiresAt) ||
        !isAllowedMediaContentType(this.options.kind, value.contentType) ||
        typeof value.etag !== 'string'
      ) {
        return null;
      }
      return value as MediaCacheMetadata;
    } catch {
      return null;
    }
  }

  private async atomicMetadataWrite(metadata: MediaCacheMetadata) {
    const temp = `${this.metadataPath(metadata.key)}.tmp-${randomUUID()}`;
    await fs.writeFile(temp, JSON.stringify(metadata), { flag: 'wx' });
    await fs.rename(temp, this.metadataPath(metadata.key));
  }

  private async remove(key: string): Promise<boolean> {
    const results = await Promise.all([
      fs.unlink(this.dataPath(key)).then(
        () => true,
        () => false,
      ),
      fs.unlink(this.metadataPath(key)).then(
        () => true,
        () => false,
      ),
    ]);
    return results.some(Boolean);
  }

  private dataPath(key: string) {
    return path.join(this.options.rootDir, `${key}.bin`);
  }

  private metadataPath(key: string) {
    return path.join(this.options.rootDir, `${key}.json`);
  }

  private async ensureDirectory(): Promise<boolean> {
    if (this.enabled !== undefined) return this.enabled;
    if (process.env.VERCEL || process.env.DISABLE_DISK_CACHE === 'true') {
      this.enabled = false;
      return false;
    }
    try {
      await fs.mkdir(this.options.rootDir, { recursive: true });
      await fs.access(this.options.rootDir, constants.W_OK);
      this.enabled = true;
    } catch {
      this.enabled = false;
    }
    return this.enabled;
  }
}

function envBytes(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const mediaRoot = process.env.MEDIA_CACHE_DIR || '/app/cache';

export const imageDiskCache = new DiskMediaCache({
  rootDir: path.join(mediaRoot, 'image'),
  kind: 'image',
  maxBytes: envBytes('IMAGE_CACHE_MAX_BYTES', 512 * 1024 * 1024),
  maxEntryBytes: envBytes('IMAGE_CACHE_MAX_ENTRY_BYTES', 20 * 1024 * 1024),
});

export const videoDiskCache = new DiskMediaCache({
  rootDir: path.join(mediaRoot, 'video'),
  kind: 'video',
  maxBytes: envBytes('VIDEO_CACHE_MAX_BYTES', 2 * 1024 * 1024 * 1024),
  maxEntryBytes: envBytes('VIDEO_CACHE_MAX_ENTRY_BYTES', 100 * 1024 * 1024),
});
