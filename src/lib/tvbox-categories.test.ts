import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTVBoxCategoriesUrl,
  clearTVBoxCategoryCache,
  DEFAULT_TVBOX_CATEGORIES,
  getTVBoxCategories,
  parseTVBoxCategories,
} from './tvbox-categories.ts';

test('builds category URLs without duplicating query separators', () => {
  assert.equal(
    buildTVBoxCategoriesUrl('https://example.com/api?key=value'),
    'https://example.com/api?key=value&ac=list',
  );
  const proxiedUrl = new URL(
    buildTVBoxCategoriesUrl(
      'https://proxy.example/p/source?url=https%3A%2F%2Forigin.example%2Fapi%3Fkey%3Dvalue',
    )!,
  );
  assert.equal(proxiedUrl.hostname, 'proxy.example');
  const upstreamUrl = new URL(proxiedUrl.searchParams.get('url')!);
  assert.equal(upstreamUrl.hostname, 'origin.example');
  assert.equal(upstreamUrl.searchParams.get('key'), 'value');
  assert.equal(upstreamUrl.searchParams.get('ac'), 'list');
});

test('parses MacCMS categories and rejects HTML responses', () => {
  assert.deepEqual(
    parseTVBoxCategories(
      JSON.stringify({
        class: [
          { type_id: 1, type_name: '电影' },
          { type_id: 2, name: '电视剧' },
          { type_id: 3, type_name: '电影' },
        ],
      }),
    ),
    ['电影', '电视剧'],
  );
  assert.equal(
    parseTVBoxCategories('<!doctype html><title>Site</title>'),
    null,
  );
});

test('caches fallback categories for non-JSON upstream responses', async () => {
  clearTVBoxCategoryCache();
  let fetchCount = 0;
  const fetcher = async () => {
    fetchCount += 1;
    return new Response('<!doctype html><title>Site</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  };

  assert.deepEqual(
    await getTVBoxCategories('https://example.com/api', fetcher),
    DEFAULT_TVBOX_CATEGORIES,
  );
  assert.deepEqual(
    await getTVBoxCategories('https://example.com/api', fetcher),
    DEFAULT_TVBOX_CATEGORIES,
  );
  assert.equal(fetchCount, 1);
  clearTVBoxCategoryCache();
});
