import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AD_FILTER_CONFIG,
  filterM3u8Ads,
  normalizeAdFilterConfig,
} from './ad-filter.ts';

test('normalizes ad filter input without accepting executable code', () => {
  assert.deepEqual(normalizeAdFilterConfig(null), DEFAULT_AD_FILTER_CONFIG);
  const config = normalizeAdFilterConfig({
    enabled: true,
    globalKeywords: [' ad ', '', 12],
    sourceRules: [{ source: 'demo', keywords: ['promo'], durations: [5.64] }],
    code: 'alert(1)',
  });
  assert.deepEqual(config.globalKeywords, ['ad']);
  assert.equal('code' in config, false);
});

test('filters cue blocks, keyword URLs and source-specific durations', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-CUE-OUT:10',
    '#EXTINF:5,',
    'https://cdn.example/ad-one.ts',
    '#EXT-X-CUE-IN',
    '#EXTINF:5.64,',
    'https://cdn.example/segment-one.ts',
    '#EXTINF:10,',
    'https://cdn.example/content.ts',
  ].join('\n');
  const output = filterM3u8Ads('demo', input, {
    ...DEFAULT_AD_FILTER_CONFIG,
    sourceRules: [{ source: 'demo', keywords: [], durations: [5.64] }],
  });
  assert.equal(output.includes('ad-one.ts'), false);
  assert.equal(output.includes('segment-one.ts'), false);
  assert.equal(output.includes('content.ts'), true);
});
