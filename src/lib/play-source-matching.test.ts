import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesRequestedYear } from './play-source-matching.ts';

test('a missing requested year does not filter title search results', () => {
  assert.equal(matchesRequestedYear('', '2026'), true);
  assert.equal(matchesRequestedYear('   ', '2026'), true);
  assert.equal(matchesRequestedYear(undefined, '2026'), true);
});

test('a supplied year still disambiguates title search results', () => {
  assert.equal(matchesRequestedYear('2026', '2026'), true);
  assert.equal(matchesRequestedYear('2026', '2025'), false);
});

test('missing or nonnumeric candidate years preserve the title fallback', () => {
  assert.equal(matchesRequestedYear('2026', ''), true);
  assert.equal(matchesRequestedYear('2026', 'unknown'), true);
});
