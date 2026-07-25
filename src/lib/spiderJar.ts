import { createHash, timingSafeEqual } from 'node:crypto';

import { safeFetch } from '@/lib/safe-upstream-url';

const DEFAULT_JAR_URL =
  'https://raw.githubusercontent.com/FongMi/CatVodSpider/a511a606a287089dffdd8374db75d95ec5f372b6/jar/custom_spider.jar';
const DEFAULT_JAR_SHA256 =
  '89f5f6e4aeccd3bb0a71c49cee5f4d16d67418d23c35b082c4598419b1138b7b';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_JAR_SIZE = 10 * 1024 * 1024;

export interface SpiderJarInfo {
  buffer: Buffer;
  md5: string;
  sha256: string;
  source: string;
  success: boolean;
  cached: boolean;
  timestamp: number;
  size: number;
  tried: number;
}

let cache: SpiderJarInfo | null = null;

function getPinnedJar() {
  const configuredUrl = process.env.SPIDER_JAR_URL?.trim();
  const configuredHash = process.env.SPIDER_JAR_SHA256?.trim().toLowerCase();
  if (
    (configuredUrl && !configuredHash) ||
    (!configuredUrl && configuredHash)
  ) {
    throw new Error(
      'SPIDER_JAR_URL and SPIDER_JAR_SHA256 must be configured together',
    );
  }

  const url = configuredUrl || DEFAULT_JAR_URL;
  const sha256 = configuredHash || DEFAULT_JAR_SHA256;
  if (!/^[a-f\d]{64}$/.test(sha256)) {
    throw new Error('SPIDER_JAR_SHA256 must be a valid SHA-256 digest');
  }
  return { url, sha256 };
}

function digest(algorithm: 'md5' | 'sha256', buffer: Buffer) {
  return createHash(algorithm).update(buffer).digest('hex');
}

function hashesEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function getSpiderJar(
  forceRefresh = false,
): Promise<SpiderJarInfo> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.timestamp < CACHE_TTL) {
    return { ...cache, cached: true };
  }

  const pinned = getPinnedJar();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await safeFetch(pinned.url, {
      allowedHosts: ['raw.githubusercontent.com'],
      maxRedirects: 2,
      signal: controller.signal,
      headers: {
        Accept: 'application/java-archive, application/octet-stream',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Dong-Media-SpiderJar/1.0',
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Pinned spider JAR returned HTTP ${response.status}`);
    }

    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_JAR_SIZE) {
      await response.body?.cancel();
      throw new Error('Pinned spider JAR is too large');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (
      buffer.length < 1000 ||
      buffer.length > MAX_JAR_SIZE ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b
    ) {
      throw new Error('Pinned spider JAR has an invalid file format');
    }

    const sha256 = digest('sha256', buffer);
    if (!hashesEqual(sha256, pinned.sha256)) {
      throw new Error('Pinned spider JAR failed SHA-256 verification');
    }

    const info: SpiderJarInfo = {
      buffer,
      md5: digest('md5', buffer),
      sha256,
      source: pinned.url,
      success: true,
      cached: false,
      timestamp: now,
      size: buffer.length,
      tried: 1,
    };
    cache = info;
    return info;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getSpiderStatus() {
  return cache ? { ...cache, buffer: undefined } : null;
}

export function getCandidates(): string[] {
  return [getPinnedJar().url];
}

export function getAllCandidates() {
  return {
    domestic: [] as string[],
    international: [getPinnedJar().url],
    proxy: [] as string[],
  };
}
