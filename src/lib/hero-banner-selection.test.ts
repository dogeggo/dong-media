import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findNextHeroBannerCandidate,
  getHeroBannerCandidateKey,
} from './hero-banner-selection.ts';

interface Candidate {
  id: number;
  title: string;
  type: 'movie' | 'tv';
}

const candidates: Candidate[] = [
  { id: 1, title: '电影一', type: 'movie' },
  { id: 2, title: '电影二', type: 'movie' },
  { id: 3, title: '电影三', type: 'movie' },
  { id: 4, title: '剧集一', type: 'tv' },
  { id: 5, title: '剧集二', type: 'tv' },
];

test('hero banner replacement uses the next item from the same category', () => {
  const next = findNextHeroBannerCandidate(
    candidates[0],
    [candidates[0], candidates[3]],
    candidates,
    new Set(),
  );

  assert.equal(next?.id, 2);
});

test('hero banner replacement skips displayed and rejected items', () => {
  const next = findNextHeroBannerCandidate(
    candidates[0],
    [candidates[0], candidates[1], candidates[3]],
    candidates,
    new Set(),
  );

  assert.equal(next?.id, 3);

  const exhausted = findNextHeroBannerCandidate(
    candidates[0],
    [candidates[0], candidates[1], candidates[3]],
    candidates,
    new Set([getHeroBannerCandidateKey(candidates[2])]),
  );

  assert.equal(exhausted, undefined);
});

test('hero banner replacement never crosses into another category', () => {
  const next = findNextHeroBannerCandidate(
    candidates[2],
    [candidates[2]],
    candidates,
    new Set(),
  );

  assert.equal(next, undefined);
});
