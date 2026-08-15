import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS,
  isInactiveUserExemptFromCleanup,
  MAX_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS,
  normalizeInactiveUserCleanupExemptWatchHours,
} from './inactive-user-cleanup.ts';

test('uses a ten-hour cleanup exemption threshold by default', () => {
  assert.equal(
    normalizeInactiveUserCleanupExemptWatchHours(undefined),
    DEFAULT_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS,
  );
  assert.equal(isInactiveUserExemptFromCleanup(10 * 60 * 60, undefined), false);
  assert.equal(
    isInactiveUserExemptFromCleanup(10 * 60 * 60 + 1, undefined),
    true,
  );
});

test('honors a configurable cleanup exemption threshold', () => {
  assert.equal(isInactiveUserExemptFromCleanup(2 * 60 * 60, 1.5), true);
  assert.equal(isInactiveUserExemptFromCleanup(60 * 60, 1.5), false);
  assert.equal(isInactiveUserExemptFromCleanup(1, 0), true);
});

test('normalizes invalid or excessive cleanup exemption thresholds', () => {
  assert.equal(
    normalizeInactiveUserCleanupExemptWatchHours(Number.NaN),
    DEFAULT_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS,
  );
  assert.equal(normalizeInactiveUserCleanupExemptWatchHours(-1), 0);
  assert.equal(normalizeInactiveUserCleanupExemptWatchHours(1.236), 1.24);
  assert.equal(
    normalizeInactiveUserCleanupExemptWatchHours(
      MAX_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS + 1,
    ),
    MAX_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS,
  );
  assert.equal(isInactiveUserExemptFromCleanup(Number.NaN, 10), false);
});
