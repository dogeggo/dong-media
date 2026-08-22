import assert from 'node:assert/strict';
import test from 'node:test';

import { CACHE_POLICIES } from './cache-system/policies.ts';
import { scrapeMovieHomepage } from './release-calendar-scraper.ts';
import { assertCompleteReleaseCalendar } from './release-calendar-validation.ts';
import type { ReleaseCalendarItem } from './types.ts';

function release(type: 'movie' | 'tv', title: string): ReleaseCalendarItem {
  return {
    id: `${type}-${title}`,
    title,
    type,
    director: '',
    actors: '',
    region: '',
    genre: '',
    releaseDate: '2099-12-31',
    source: 'manmankan',
    createdAt: 0,
    updatedAt: 0,
  };
}

function homepageHtml(title: string): string {
  return `
    <div class="sjbul-d">
      <a href="/dy2013/209912/123.shtml" title="${title}" target="_blank" class="ddp1">
      <a title="${title}" target="_blank" href="/dy2013/209912/123.shtml">
      <p class="ddp2">上映：<span>12月31日</span></p>
    </div>
  `;
}

test('homepage fallback skips an HTTP 200 page with no parseable releases', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(console, 'warn', () => undefined);

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://www.manmankan.com/')) {
      return new Response('<html><body>empty upstream page</body></html>');
    }
    if (url.startsWith('https://g.manmankan.com/')) {
      return new Response(homepageHtml('备用电影'));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const items = await scrapeMovieHomepage();

  assert.deepEqual(calls, [
    'https://www.manmankan.com/dy2013/dianying/',
    'https://g.manmankan.com/dy2013/dianying/',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, '备用电影');
  assert.equal(items[0]?.type, 'movie');
});

test('calendar completeness requires both movie and TV data', () => {
  assert.doesNotThrow(() =>
    assertCompleteReleaseCalendar([
      release('movie', '电影'),
      release('tv', '电视剧'),
    ]),
  );
  assert.throws(
    () => assertCompleteReleaseCalendar([release('tv', '电视剧')]),
    /缺少电影数据/,
  );
  assert.throws(
    () => assertCompleteReleaseCalendar([release('movie', '电影')]),
    /缺少电视剧数据/,
  );
});

test('calendar cache ignores snapshots written before completeness checks', () => {
  assert.equal(CACHE_POLICIES.RELEASE_CALENDAR.version, 2);
});
