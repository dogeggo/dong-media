import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findShortDramaCategoryTrees,
  matchShortDramaCategoryId,
  normalizeShortDramaSourceKeys,
  uniqueHttpUrls,
} from './shortdrama-source.ts';

test('expands an empty short-drama parent into its CMS child categories', () => {
  assert.deepEqual(
    findShortDramaCategoryTrees([
      { type_id: 24, type_pid: 0, type_name: '短剧' },
      { type_id: 49, type_pid: 24, type_name: '古装仙侠' },
      { type_id: '50', type_pid: '24', type_name: '现代都市' },
      { type_id: 51, type_pid: 24, type_name: '擦边短剧' },
      { type_id: 52, type_pid: 51, type_name: '擦边子分类' },
      { type_id: 10, type_pid: 0, type_name: '国产剧' },
    ]),
    [
      {
        rootId: '24',
        categoryIds: ['24', '49', '50'],
        descendantIds: ['49', '50'],
        categories: [
          { id: '24', name: '短剧' },
          { id: '49', name: '古装仙侠' },
          { id: '50', name: '现代都市' },
        ],
        descendants: [
          { id: '49', name: '古装仙侠' },
          { id: '50', name: '现代都市' },
        ],
      },
    ],
  );
});

test('does not duplicate a named short-drama category nested under a root', () => {
  assert.deepEqual(
    findShortDramaCategoryTrees([
      { type_id: 1, type_pid: 0, type_name: '短剧' },
      { type_id: 2, type_pid: 1, type_name: '爽文短剧' },
      { type_id: 3, type_pid: 2, type_name: '成长逆袭' },
    ]),
    [
      {
        rootId: '1',
        categoryIds: ['1', '2', '3'],
        descendantIds: ['2', '3'],
        categories: [
          { id: '1', name: '短剧' },
          { id: '2', name: '爽文短剧' },
          { id: '3', name: '成长逆袭' },
        ],
        descendants: [
          { id: '2', name: '爽文短剧' },
          { id: '3', name: '成长逆袭' },
        ],
      },
    ],
  );
});

test('recognizes a standalone short-drama category and ignores invalid IDs', () => {
  assert.deepEqual(
    findShortDramaCategoryTrees([
      { type_id: 45, type_name: '爽文短剧' },
      { type_name: '短剧' },
      { type_id: '', type_name: '短剧' },
    ]),
    [
      {
        rootId: '45',
        categoryIds: ['45'],
        descendantIds: [],
        categories: [{ id: '45', name: '爽文短剧' }],
        descendants: [],
      },
    ],
  );
});

test('remaps a category by name when another source reuses the numeric ID', () => {
  const [tree] = findShortDramaCategoryTrees([
    { type_id: 27, type_pid: 0, type_name: '短剧' },
    { type_id: 49, type_pid: 27, type_name: '年代穿越' },
    { type_id: 50, type_pid: 27, type_name: '古装仙侠' },
  ]);

  assert.equal(matchShortDramaCategoryId(tree, '49', '古装仙侠'), '50');
  assert.equal(matchShortDramaCategoryId(tree, '49', '年代穿越'), '49');
  assert.equal(matchShortDramaCategoryId(tree, '999', '古装仙侠'), '50');
  assert.equal(matchShortDramaCategoryId(tree, '999', '不存在'), null);
});

test('normalizes and de-duplicates valid HTTP source URLs', () => {
  assert.deepEqual(
    uniqueHttpUrls([
      ' https://example.com/api.php/provide/vod ',
      'https://example.com/api.php/provide/vod',
      'http://backup.example.com/vod',
      'file:///tmp/source',
      'not a url',
      undefined,
    ]),
    [
      'https://example.com/api.php/provide/vod',
      'http://backup.example.com/vod',
    ],
  );
});

test('migrates legacy short-drama URLs to ordered existing source keys', () => {
  const sources = [
    { key: 'source-a', api: 'https://a.example.com/vod' },
    { key: 'source-b', api: 'https://b.example.com/vod' },
    { key: 'source-c', api: 'https://c.example.com/vod' },
  ];

  assert.deepEqual(
    normalizeShortDramaSourceKeys(
      undefined,
      'https://b.example.com/vod; https://missing.example.com/vod;https://a.example.com/vod',
      sources,
    ),
    ['source-b', 'source-a'],
  );
});

test('keeps configured source priority while dropping duplicates and removed keys', () => {
  assert.deepEqual(
    normalizeShortDramaSourceKeys(
      ['source-c', 'removed', 'source-a', 'source-c'],
      'https://b.example.com/vod',
      [
        { key: 'source-a', api: 'https://a.example.com/vod' },
        { key: 'source-b', api: 'https://b.example.com/vod' },
        { key: 'source-c', api: 'https://c.example.com/vod' },
      ],
    ),
    ['source-c', 'source-a'],
  );
});
