import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlayStats } from './play-stats.ts';
import type { PlayRecord, UserStatsSnapshot } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function playRecord(
  sourceName: string,
  saveTime: number,
  playTime: number,
): PlayRecord {
  return {
    title: `${sourceName} video`,
    source_name: sourceName,
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 1,
    play_time: playTime,
    total_time: 3600,
    save_time: saveTime,
    search_title: `${sourceName} video`,
  };
}

test('buildPlayStats aggregates snapshots without rereading records', async () => {
  const now = Date.UTC(2026, 7, 15, 12);
  const snapshots: Record<string, UserStatsSnapshot> = {
    alice: {
      userStat: {
        username: 'alice',
        totalWatchTime: 300,
        totalPlays: 3,
        totalMovies: 2,
        lastLoginTime: now - 60 * 60 * 1000,
      },
      playRecords: {
        a: playRecord('source-a', now - DAY_MS, 120),
        b: playRecord('source-a', now - 2 * DAY_MS, 60),
      },
    },
    bob: {
      userStat: {
        username: 'bob',
        totalWatchTime: 100,
        totalPlays: 1,
        totalMovies: 1,
        lastLoginTime: now - 10 * DAY_MS,
      },
      playRecords: {
        c: playRecord('source-b', now - DAY_MS, 30),
      },
    },
  };
  const loadCounts = new Map<string, number>();

  const result = await buildPlayStats(
    [
      { username: 'alice', createdAt: now - 2 * DAY_MS },
      { username: 'bob', createdAt: now },
    ],
    async (username) => {
      loadCounts.set(username, (loadCounts.get(username) || 0) + 1);
      return snapshots[username];
    },
    { now, concurrency: 2 },
  );

  assert.deepEqual(Object.fromEntries(loadCounts), { alice: 1, bob: 1 });
  assert.equal(result.totalUsers, 2);
  assert.equal(result.totalWatchTime, 400);
  assert.equal(result.totalPlays, 4);
  assert.equal(result.totalMovies, 3);
  assert.deepEqual(result.topSources, [
    { source: 'source-a', count: 2 },
    { source: 'source-b', count: 1 },
  ]);
  assert.equal(result.dailyStats.at(-2)?.watchTime, 150);
  assert.equal(result.dailyStats.at(-3)?.watchTime, 60);
  assert.deepEqual(result.activeUsers, { daily: 1, weekly: 1, monthly: 2 });
  assert.equal(result.registrationStats.todayNewUsers, 1);
});

test('buildPlayStats limits concurrent storage reads', async () => {
  const users = Array.from({ length: 20 }, (_, index) => ({
    username: `user-${index}`,
  }));
  let activeLoads = 0;
  let peakLoads = 0;

  await buildPlayStats(
    users,
    async (username) => {
      activeLoads++;
      peakLoads = Math.max(peakLoads, activeLoads);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeLoads--;
      return {
        userStat: { username },
        playRecords: {},
      };
    },
    { concurrency: 3 },
  );

  assert.equal(peakLoads, 3);
});
