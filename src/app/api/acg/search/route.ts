import { NextRequest, NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  CACHE_POLICIES,
  cacheService,
  normalizeQuery,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

export const runtime = 'nodejs';

interface AcgSearchItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  torrentUrl: string;
  description: string;
  images: string[];
}

interface AcgSearchResult {
  keyword: string;
  page: number;
  total: number;
  items: AcgSearchItem[];
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function POST(request: NextRequest) {
  if (!getAuthInfoFromCookie(request)?.username) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      keyword?: unknown;
      page?: unknown;
    };
    if (typeof body.keyword !== 'string') {
      return json({ error: '搜索关键词不能为空' }, { status: 400 });
    }
    const keyword = normalizeQuery(body.keyword, false);
    if (!keyword || keyword.length > 100) {
      return json({ error: '搜索关键词必须为 1-100 个字符' }, { status: 400 });
    }
    const page = Number(body.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000) {
      return json({ error: '页码必须是大于0的整数' }, { status: 400 });
    }

    const result = await cacheService.getOrLoad(
      CACHE_POLICIES.ACG_SEARCH,
      { keyword, page },
      () => fetchAcgSearch(keyword, page),
      { isNegative: (value) => value.items.length === 0 },
    );
    return json(result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('ACG 搜索失败:', error);
    return json({ error: '搜索失败' }, { status: 502 });
  }
}

async function fetchAcgSearch(
  keyword: string,
  page: number,
): Promise<AcgSearchResult> {
  const response = await fetch(
    `https://acg.rip/page/${page}.xml?term=${encodeURIComponent(keyword)}`,
    {
      cache: 'no-store',
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ACG.RIP returned ${response.status}`);
  }

  const parsed = (await parseStringPromise(await response.text())) as {
    rss?: { channel?: Array<{ item?: unknown[] }> };
  };
  const rawItems = parsed.rss?.channel?.[0]?.item || [];
  const items = rawItems.map((raw) => normalizeItem(raw));
  return { keyword, page, total: items.length, items };
}

function normalizeItem(raw: unknown): AcgSearchItem {
  const item = raw as Record<string, unknown[]>;
  const description = String(item.description?.[0] || '');
  const images = Array.from(
    description.matchAll(/src=["']([^"']+)["']/gi),
    (match) => match[1],
  ).filter(Boolean);
  const enclosure = item.enclosure?.[0] as { $?: { url?: string } } | undefined;
  return {
    title: String(item.title?.[0] || ''),
    link: String(item.link?.[0] || ''),
    guid: String(item.guid?.[0] || ''),
    pubDate: String(item.pubDate?.[0] || ''),
    torrentUrl: String(enclosure?.$?.url || ''),
    description,
    images,
  };
}
