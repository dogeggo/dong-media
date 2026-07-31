import type { BangumiCalendarData } from './bangumi-api.ts';
import { CACHE_POLICIES, cacheService } from './cache-system/index.ts';
import { processImageUrl } from './image-url.ts';
import { safeFetch } from './safe-upstream-url.ts';

function processBangumiImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(processBangumiImages);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const isImage =
        key === 'large' ||
        key === 'common' ||
        key === 'medium' ||
        key === 'small' ||
        key === 'grid';
      return [
        key,
        isImage && typeof item === 'string' && item.startsWith('http')
          ? processImageUrl(item)
          : processBangumiImages(item),
      ];
    }),
  );
}

export async function getCachedBangumiData(path: string) {
  return cacheService.getOrLoadResult(
    CACHE_POLICIES.BANGUMI_PROXY,
    { path },
    async () => {
      const response = await safeFetch(`https://api.bgm.tv/${path}`, {
        allowedHosts: ['api.bgm.tv'],
        maxRedirects: 0,
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        throw new Error(`Bangumi API returned ${response.status}`);
      }
      return processBangumiImages(await response.json());
    },
  );
}

export function isBangumiCalendarData(
  value: unknown,
): value is BangumiCalendarData[] {
  return (
    Array.isArray(value) &&
    value.every(
      (day) =>
        day &&
        typeof day === 'object' &&
        'weekday' in day &&
        'items' in day &&
        Array.isArray(day.items),
    )
  );
}
