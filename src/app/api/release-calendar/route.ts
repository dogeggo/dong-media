import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  CACHE_POLICIES,
  cacheService,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { getReleaseCalendarWithFilters } from '@/lib/release-calendar-scraper';
import { ReleaseCalendarResult } from '@/lib/types';

export const runtime = 'nodejs';

type CalendarCacheValue = ReleaseCalendarResult;

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

async function loadFullCalendar(): Promise<CalendarCacheValue> {
  const { allCalendar, filters } = await getReleaseCalendarWithFilters({});
  if (allCalendar.items.length === 0) {
    throw new Error('发布日历上游未返回可用数据');
  }
  return {
    items: allCalendar.items,
    total: allCalendar.total,
    hasMore: allCalendar.hasMore,
    filters,
  };
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const type = params.get('type') as 'movie' | 'tv' | null;
  const region = params.get('region');
  const genre = params.get('genre');
  const dateFrom = params.get('dateFrom');
  const dateTo = params.get('dateTo');
  const limitValue = params.get('limit');
  const limit = limitValue ? Number(limitValue) : undefined;
  const offset = Number(params.get('offset') || '0');
  const refresh = params.get('refresh') === 'true' || params.has('nocache');

  if (refresh && !(await canRefreshCalendar(authInfo.username))) {
    return privateJson({ error: 'Forbidden' }, { status: 403 });
  }

  if (type && type !== 'movie' && type !== 'tv') {
    return privateJson(
      { error: 'type 参数必须是 movie 或 tv' },
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return privateJson({ error: 'offset 必须为非负整数' }, { status: 400 });
  }
  if (
    limit !== undefined &&
    (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
  ) {
    return privateJson({ error: 'limit 必须为 1-500 的整数' }, { status: 400 });
  }

  try {
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.RELEASE_CALENDAR,
      { projection: 'full' },
      loadFullCalendar,
      {
        forceRefresh: refresh,
      },
    );
    if (refresh && cached.status === 'STALE') {
      return privateJson(
        {
          success: false,
          error: '发布日历刷新失败，已保留旧缓存',
          stalePreserved: true,
          itemCount: cached.value.items.length,
        },
        { status: 502 },
      );
    }
    const calendar = cached.value;
    let items = calendar.items;
    if (type) items = items.filter((item) => item.type === type);
    if (region && region !== '全部') {
      items = items.filter((item) => item.region.includes(region));
    }
    if (genre && genre !== '全部') {
      items = items.filter((item) => item.genre.includes(genre));
    }
    if (dateFrom) {
      items = items.filter((item) => item.releaseDate >= dateFrom);
    }
    if (dateTo) items = items.filter((item) => item.releaseDate <= dateTo);

    const total = items.length;
    const pageItems = limit
      ? items.slice(offset, offset + limit)
      : items.slice(offset);
    return privateJson({
      items: pageItems,
      total,
      hasMore: limit ? offset + limit < total : false,
      filters: calendar.filters,
    });
  } catch (error) {
    return privateJson(
      {
        error: '获取发布日历失败',
        details: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await canRefreshCalendar(authInfo.username))) {
    return privateJson({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.RELEASE_CALENDAR,
      { projection: 'full' },
      loadFullCalendar,
      { forceRefresh: true },
    );
    if (cached.status === 'STALE') {
      return privateJson(
        {
          success: false,
          error: '发布日历刷新失败，已保留旧缓存',
          stalePreserved: true,
          itemCount: cached.value.items.length,
        },
        { status: 502 },
      );
    }
    return privateJson({
      success: true,
      message: '发布日历缓存已原子刷新',
      itemCount: cached.value.items.length,
    });
  } catch (error) {
    return privateJson(
      {
        error: '刷新发布日历缓存失败',
        details: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 },
    );
  }
}

async function canRefreshCalendar(username: string): Promise<boolean> {
  if (username === process.env.USERNAME) return true;
  const config = await loadConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === username,
  );
  return Boolean(user && !user.banned && user.role === 'admin');
}
