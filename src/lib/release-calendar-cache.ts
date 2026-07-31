import { CACHE_POLICIES, cacheService } from './cache-system/index.ts';
import { getReleaseCalendarWithFilters } from './release-calendar-scraper.ts';
import type { ReleaseCalendarResult } from './types.ts';

export type CalendarCacheValue = ReleaseCalendarResult;

export const RELEASE_CALENDAR_CACHE_PARAMS = { projection: 'full' } as const;

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

export function readCachedReleaseCalendar() {
  return cacheService.getCachedResult<CalendarCacheValue>(
    CACHE_POLICIES.RELEASE_CALENDAR,
    RELEASE_CALENDAR_CACHE_PARAMS,
  );
}

export function getReleaseCalendarCache(options?: { forceRefresh?: boolean }) {
  return cacheService.getOrLoadResult(
    CACHE_POLICIES.RELEASE_CALENDAR,
    RELEASE_CALENDAR_CACHE_PARAMS,
    loadFullCalendar,
    { forceRefresh: options?.forceRefresh },
  );
}

export async function warmReleaseCalendarCache() {
  const cached = await readCachedReleaseCalendar();
  if (cached?.status === 'HIT') return cached;
  return getReleaseCalendarCache({ forceRefresh: Boolean(cached) });
}
