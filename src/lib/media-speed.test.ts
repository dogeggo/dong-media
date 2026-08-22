import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTransferSpeedBytesPerSecond,
  formatTransferSpeed,
  getHlsTransferSpeedSample,
  isMeasurableMediaFragment,
} from './media-speed.ts';

const MEBIBYTE = 1024 * 1024;

test('keeps distinct speeds above the previous 50 MB/s cap', () => {
  const faster = getHlsTransferSpeedSample({
    frag: {
      type: 'main',
      stats: {
        loaded: 8 * MEBIBYTE,
        loading: { start: 5, first: 10, end: 50 },
      },
    },
  });
  const fast = getHlsTransferSpeedSample({
    frag: {
      type: 'main',
      stats: {
        loaded: 8 * MEBIBYTE,
        loading: { start: 5, first: 10, end: 90 },
      },
    },
  });

  assert.ok(faster);
  assert.ok(fast);
  assert.equal(
    formatTransferSpeed(calculateTransferSpeedBytesPerSecond([faster])!),
    '200.00 MB/s',
  );
  assert.equal(
    formatTransferSpeed(calculateTransferSpeedBytesPerSecond([fast])!),
    '100.00 MB/s',
  );
});

test('uses transfer time instead of including time to first byte', () => {
  const sample = getHlsTransferSpeedSample({
    frag: {
      type: 'main',
      stats: {
        loaded: 2 * MEBIBYTE,
        loading: { start: 100, first: 150, end: 250 },
      },
    },
  });

  assert.deepEqual(sample, {
    durationMs: 100,
    loadedBytes: 2 * MEBIBYTE,
  });
  assert.equal(
    formatTransferSpeed(calculateTransferSpeedBytesPerSecond([sample!])!),
    '20.00 MB/s',
  );
});

test('weights samples by their bytes and actual duration', () => {
  const speed = calculateTransferSpeedBytesPerSecond([
    { loadedBytes: MEBIBYTE, durationMs: 50 },
    { loadedBytes: 3 * MEBIBYTE, durationMs: 300 },
  ]);

  assert.equal(formatTransferSpeed(speed!), '11.43 MB/s');
});

test('falls back to payload size and matching event timing', () => {
  const sample = getHlsTransferSpeedSample(
    {
      frag: { type: 'main', stats: { loaded: 0 } },
      payload: { byteLength: MEBIBYTE },
    },
    100,
    300,
  );

  assert.deepEqual(sample, {
    durationMs: 200,
    loadedBytes: MEBIBYTE,
  });
});

test('excludes init and alternate-audio fragments from speed samples', () => {
  assert.equal(
    isMeasurableMediaFragment({ frag: { sn: 'initSegment', type: 'main' } }),
    false,
  );
  assert.equal(
    isMeasurableMediaFragment({ frag: { sn: 1, type: 'audio' } }),
    false,
  );
  assert.equal(
    isMeasurableMediaFragment({ frag: { sn: 1, type: 'main' } }),
    true,
  );
});
