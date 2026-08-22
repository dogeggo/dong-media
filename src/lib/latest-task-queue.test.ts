import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestTaskQueue } from './latest-task-queue.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('runs the active value and only the newest pending value', async () => {
  const first = deferred();
  const values: number[] = [];
  const queue = createLatestTaskQueue<number>(async (value) => {
    values.push(value);
    if (value === 1) await first.promise;
  });

  const active = queue.enqueue(1);
  const second = queue.enqueue(2);
  const third = queue.enqueue(3);
  first.resolve();

  await Promise.all([active, second, third]);
  assert.deepEqual(values, [1, 3]);
});

test('continues with a newer value after an obsolete request fails', async () => {
  const first = deferred();
  const values: number[] = [];
  const queue = createLatestTaskQueue<number>(async (value) => {
    values.push(value);
    if (value === 1) {
      await first.promise;
      throw new Error('obsolete request failed');
    }
  });

  const active = queue.enqueue(1);
  const latest = queue.enqueue(2);
  first.resolve();

  await Promise.all([active, latest]);
  assert.deepEqual(values, [1, 2]);
});

test('rejects when the latest request fails', async () => {
  const queue = createLatestTaskQueue<number>(async () => {
    throw new Error('save failed');
  });

  await assert.rejects(queue.enqueue(1), /save failed/);
});

test('accepts undefined as a queued value', async () => {
  let calls = 0;
  const queue = createLatestTaskQueue<undefined>(async () => {
    calls += 1;
  });

  await queue.enqueue(undefined);
  assert.equal(calls, 1);
});
