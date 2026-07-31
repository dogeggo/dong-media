import type { BangumiCalendarData } from './bangumi-api.ts';
import type { ReleaseCalendarItem } from './types.ts';

export interface HomeBangumiItem {
  air_date?: string;
  id: number;
  image?: string;
  name: string;
  name_cn?: string;
  score?: number;
}

export type HomeUpcomingItem = Pick<
  ReleaseCalendarItem,
  'cover' | 'episodes' | 'id' | 'releaseDate' | 'title' | 'type'
>;

const SEASON_PATTERN = /第[一二三四五六七八九十\d]+季|Season\s*\d+|S\d+/i;

function normalizeReleaseTitle(title: string): string {
  const normalized = title.replace(/[：:]/g, ':').trim();
  const colonIndex = normalized.lastIndexOf(':');
  const withoutSubtitle =
    colonIndex === -1 ? normalized : normalized.slice(colonIndex + 1).trim();
  return withoutSubtitle.replace(SEASON_PATTERN, '').replace(/\s+/g, '').trim();
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueUpcomingItems(items: ReleaseCalendarItem[]) {
  const exactTitles = new Map<string, ReleaseCalendarItem>();
  const normalizedTitles = new Map<string, string>();

  for (const item of items) {
    const exact = exactTitles.get(item.title);
    if (exact) {
      if (item.releaseDate < exact.releaseDate) {
        exactTitles.set(item.title, item);
      }
      continue;
    }

    const normalizedTitle = normalizeReleaseTitle(item.title);
    const similarEntry = Array.from(exactTitles.entries()).find(([title]) => {
      const candidate =
        normalizedTitles.get(title) || normalizeReleaseTitle(title);
      normalizedTitles.set(title, candidate);
      return candidate === normalizedTitle;
    });

    if (!similarEntry) {
      exactTitles.set(item.title, item);
      normalizedTitles.set(item.title, normalizedTitle);
      continue;
    }

    const [existingTitle, existing] = similarEntry;
    const itemHasSeason = SEASON_PATTERN.test(item.title);
    const existingHasSeason = SEASON_PATTERN.test(existingTitle);
    if (
      (!itemHasSeason && existingHasSeason) ||
      (itemHasSeason === existingHasSeason &&
        item.releaseDate < existing.releaseDate)
    ) {
      exactTitles.delete(existingTitle);
      normalizedTitles.delete(existingTitle);
      exactTitles.set(item.title, item);
      normalizedTitles.set(item.title, normalizedTitle);
    }
  }

  return Array.from(exactTitles.values()).sort((left, right) =>
    left.releaseDate.localeCompare(right.releaseDate),
  );
}

export function selectHomeUpcomingReleases(
  releases: ReleaseCalendarItem[],
  today: string,
  maxTotal = 10,
): HomeUpcomingItem[] {
  const sevenDaysAgo = addDays(today, -7);
  const sevenDaysLater = addDays(today, 7);
  const thirtyDaysLater = addDays(today, 30);
  const ninetyDaysLater = addDays(today, 90);
  const candidates = uniqueUpcomingItems(
    releases.filter(
      (item) =>
        item.releaseDate >= sevenDaysAgo && item.releaseDate <= ninetyDaysLater,
    ),
  );

  const buckets = {
    recent: candidates.filter((item) => item.releaseDate < today),
    today: candidates.filter((item) => item.releaseDate === today),
    week: candidates.filter(
      (item) => item.releaseDate > today && item.releaseDate <= sevenDaysLater,
    ),
    month: candidates.filter(
      (item) =>
        item.releaseDate > sevenDaysLater &&
        item.releaseDate <= thirtyDaysLater,
    ),
    later: candidates.filter((item) => item.releaseDate > thirtyDaysLater),
  };
  const quotas = {
    recent: Math.min(2, buckets.recent.length),
    today: Math.min(1, buckets.today.length),
    week: Math.min(4, buckets.week.length),
    month: Math.min(2, buckets.month.length),
    later: Math.min(1, buckets.later.length),
  };

  const selected = [
    ...buckets.recent.slice(0, quotas.recent),
    ...buckets.today.slice(0, quotas.today),
    ...buckets.week.slice(0, quotas.week),
    ...buckets.month.slice(0, quotas.month),
    ...buckets.later.slice(0, quotas.later),
  ];

  const append = (items: ReleaseCalendarItem[], start: number) => {
    for (const item of items.slice(start)) {
      if (selected.length >= maxTotal) return;
      if (!selected.includes(item)) selected.push(item);
    }
  };
  append(buckets.week, quotas.week);
  append(buckets.month, quotas.month);
  append(buckets.later, quotas.later);
  append(buckets.recent, quotas.recent);

  const todayLimit = Math.min(3, buckets.today.length);
  append(buckets.today.slice(0, todayLimit), quotas.today);
  return selected.slice(0, maxTotal).map((item) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    cover: item.cover,
    releaseDate: item.releaseDate,
    episodes: item.episodes,
  }));
}

export function selectBangumiItemsForWeekday(
  calendar: BangumiCalendarData[],
  weekday: string,
): HomeBangumiItem[] {
  const items =
    calendar.find(
      (item) => item.weekday.en.toLowerCase() === weekday.toLowerCase(),
    )?.items || [];
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    name_cn: item.name_cn,
    air_date: item.air_date,
    score: item.rating?.score,
    image:
      item.images?.large ||
      item.images?.common ||
      item.images?.medium ||
      item.images?.small ||
      item.images?.grid,
  }));
}

export function getShanghaiWeekday(date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(date);
}

export function getShanghaiDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}
