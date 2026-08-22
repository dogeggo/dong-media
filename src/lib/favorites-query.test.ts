import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

test('deduplicates concurrent favorite status reads and reuses fresh data', async () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const browserWindow = new EventTarget() as unknown as Window &
    typeof globalThis;
  const favorite = {
    title: 'Test title',
    source_name: 'Test source',
    year: '2026',
    cover: '',
    total_episodes: 1,
    save_time: Date.now(),
  };
  let fetchCalls = 0;

  Object.assign(browserWindow, {
    RUNTIME_CONFIG: { STORAGE_TYPE: 'redis' },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: browserWindow,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      cookie: `user_auth=${encodeURIComponent(
        JSON.stringify({ username: 'cache-test-user' }),
      )}`,
    },
  });
  globalThis.fetch = async (input) => {
    assert.equal(input, '/api/favorites');
    fetchCalls += 1;
    await Promise.resolve();
    return Response.json({ 'source+id': favorite });
  };

  // Production code uses bundler-style extensionless imports. Teach Node's
  // built-in TypeScript test runner how to resolve those local modules.
  const moduleHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith('.') || extname(specifier)) throw error;
        return nextResolve(`${specifier}.ts`, context);
      }
    },
  });

  try {
    const { getAllFavorites, isFavorited } = await import('./db.client.ts');
    const { getQueryClient } = await import('./get-query-client.ts');

    const statuses = await Promise.all(
      Array.from({ length: 25 }, () => isFavorited('source', 'id')),
    );
    const favorites = await getAllFavorites();

    assert.deepEqual(
      statuses,
      Array.from({ length: 25 }, () => true),
    );
    assert.deepEqual(favorites, { 'source+id': favorite });
    assert.equal(fetchCalls, 1);
    getQueryClient().clear();
  } finally {
    moduleHooks.deregister();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});
