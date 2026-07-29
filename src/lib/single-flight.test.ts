import assert from 'node:assert/strict';
import test from 'node:test';

import { createSingleFlight } from './single-flight.ts';

test('single flight merges concurrent work for the same key', async () => {
  const runSingleFlight = createSingleFlight<string, number>();
  let calls = 0;
  let finishTask: ((value: number) => void) | undefined;

  const first = runSingleFlight('user-a', () => {
    calls += 1;
    return new Promise<number>((resolve) => {
      finishTask = resolve;
    });
  });
  const second = runSingleFlight('user-a', () => {
    calls += 1;
    return Promise.resolve(2);
  });

  await Promise.resolve();
  assert.equal(calls, 1);
  finishTask?.(1);
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
});

test('single flight permits a new task after the previous one settles', async () => {
  const runSingleFlight = createSingleFlight<string, number>();
  let calls = 0;
  const task = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await runSingleFlight('user-a', task), 1);
  assert.equal(await runSingleFlight('user-a', task), 2);
});

test('single flight does not merge work for different keys', async () => {
  const runSingleFlight = createSingleFlight<string, string>();
  const results = await Promise.all([
    runSingleFlight('user-a', async () => 'a'),
    runSingleFlight('user-b', async () => 'b'),
  ]);

  assert.deepEqual(results, ['a', 'b']);
});
