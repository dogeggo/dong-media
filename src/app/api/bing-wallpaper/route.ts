import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';

export const dynamic = 'force-dynamic';

interface WallpaperMetadata {
  url: string;
  copyright: string;
  title: string;
  source: 'bing';
}

export async function GET(request: Request) {
  if (!hasOnlyUniqueSearchParams(new URL(request.url).searchParams, [])) {
    return NextResponse.json(
      { error: '包含未知或重复参数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  try {
    const cached = await cacheService.getOrLoadResult<WallpaperMetadata | null>(
      CACHE_POLICIES.BING_WALLPAPER_META,
      { date: dateInShanghai(), market: 'zh-CN' },
      fetchWallpaper,
      { isNegative: (value) => value === null },
    );
    if (cached.value) {
      return NextResponse.json(cached.value, {
        headers: publicApiResponseHeaders(CACHE_POLICIES.BING_WALLPAPER_META, {
          ttlSeconds: cached.ttlRemaining,
          negative: cached.negative,
        }),
      });
    }
  } catch {
    // A short-lived upstream failure must not become a shared HTTP response.
  }

  return NextResponse.json(fallbackWallpaper(), {
    headers: noStoreResponseHeaders(),
  });
}

async function fetchWallpaper(): Promise<WallpaperMetadata | null> {
  try {
    const index = Math.floor(Math.random() * 8);
    const response = await fetch(
      `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${index}&n=1&mkt=zh-CN`,
      { cache: 'no-store', signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const body = (await response.json()) as {
      images?: Array<{ url?: string; copyright?: string; title?: string }>;
    };
    const image = body.images?.[0];
    if (!image?.url) return null;
    return {
      url: new URL(image.url, 'https://www.bing.com').toString(),
      copyright: image.copyright || '',
      title: image.title || '',
      source: 'bing',
    };
  } catch {
    return null;
  }
}

function dateInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function fallbackWallpaper() {
  return {
    url: `https://picsum.photos/1920/1080?random=${Date.now()}`,
    copyright: 'Lorem Picsum - Free random images',
    title: 'Random Photo',
    source: 'picsum' as const,
  };
}
