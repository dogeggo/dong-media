import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getShanghaiDate,
  selectBangumiItemsForWeekday,
  selectHomeUpcomingReleases,
} from './home-recommendations.ts';
import type { ReleaseCalendarItem } from './types.ts';

function release(
  title: string,
  releaseDate: string,
  type: 'movie' | 'tv' = 'movie',
): ReleaseCalendarItem {
  return {
    id: `${type}-${title}-${releaseDate}`,
    title,
    type,
    director: '',
    actors: '',
    region: '',
    genre: '',
    releaseDate,
    source: 'manmankan',
    createdAt: 0,
    updatedAt: 0,
  };
}

test('home upcoming projection distributes dates and caps the result', () => {
  const items = [
    release('昨天', '2026-07-30'),
    release('今天', '2026-07-31'),
    ...Array.from({ length: 7 }, (_, index) =>
      release(`本周${index}`, `2026-08-0${index + 1}`),
    ),
    release('本月一', '2026-08-15'),
    release('本月二', '2026-08-20'),
    release('稍后', '2026-09-15'),
  ];

  const selected = selectHomeUpcomingReleases(items, '2026-07-31');
  assert.equal(selected.length, 10);
  assert.equal(
    selected.some((item) => item.title === '今天'),
    true,
  );
  assert.equal(
    selected.some((item) => item.title === '稍后'),
    true,
  );
});

test('Shanghai date projection is ISO formatted across a UTC day boundary', () => {
  assert.equal(
    getShanghaiDate(new Date('2026-07-30T16:30:00.000Z')),
    '2026-07-31',
  );
});

test('home upcoming projection deduplicates season variants', () => {
  const selected = selectHomeUpcomingReleases(
    [
      release('示例剧 第二季', '2026-08-01', 'tv'),
      release('示例剧', '2026-08-02', 'tv'),
    ],
    '2026-07-31',
  );

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.title, '示例剧');
});

test('Bangumi projection returns only the requested weekday', () => {
  const items = selectBangumiItemsForWeekday(
    [
      { weekday: { en: 'Thu' }, items: [] },
      {
        weekday: { en: 'Fri' },
        items: [{ id: 1, name: 'Friday anime' }],
      },
    ],
    'Fri',
  );
  assert.deepEqual(items, [
    {
      air_date: undefined,
      id: 1,
      image: undefined,
      name: 'Friday anime',
      name_cn: undefined,
      score: undefined,
    },
  ]);
});
