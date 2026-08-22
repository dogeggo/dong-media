import type { ReleaseCalendarItem } from './types.ts';

const REQUIRED_RELEASE_TYPES = ['movie', 'tv'] as const;

export function assertCompleteReleaseCalendar(
  items: ReleaseCalendarItem[],
  context = '发布日历数据',
): void {
  const availableTypes = new Set(items.map((item) => item.type));
  const missingTypes = REQUIRED_RELEASE_TYPES.filter(
    (type) => !availableTypes.has(type),
  );

  if (missingTypes.length === 0) return;

  const labels = missingTypes.map((type) =>
    type === 'movie' ? '电影' : '电视剧',
  );
  throw new Error(`${context}不完整：缺少${labels.join('、')}数据`);
}
