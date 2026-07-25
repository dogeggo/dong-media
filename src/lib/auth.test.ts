import type { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateHmacSignature,
  getAuthInfoFromCookie,
  isValidLocalStorageSession,
  isValidUserSession,
  localStorageSessionPayload,
  userSessionPayload,
} from './auth.ts';

const secret = 'test-session-secret';

test('parses Next.js double-encoded authentication cookies', () => {
  const encodedCookie = encodeURIComponent(
    encodeURIComponent(
      JSON.stringify({
        username: 'test_user',
        role: 'admin',
        timestamp: 123,
        signature: 'a'.repeat(64),
      }),
    ),
  );
  const request = {
    cookies: {
      get: (name: string) =>
        name === 'user_auth' ? { name, value: encodedCookie } : undefined,
    },
  } as NextRequest;

  assert.deepEqual(getAuthInfoFromCookie(request), {
    username: 'test_user',
    role: 'admin',
    timestamp: 123,
    signature: 'a'.repeat(64),
  });
});

test('accepts a current signed localStorage session', async () => {
  const timestamp = Date.now();
  const signature = await generateHmacSignature(
    localStorageSessionPayload('user', timestamp),
    secret,
  );

  assert.equal(
    await isValidLocalStorageSession(
      { role: 'user', timestamp, signature },
      secret,
      timestamp,
    ),
    true,
  );
});

test('rejects the legacy plaintext-password cookie shape', async () => {
  const legacySession = {
    role: 'user' as const,
    password: 'old-plaintext-password',
  };

  assert.equal(await isValidLocalStorageSession(legacySession, secret), false);
});

test('rejects tampered and expired localStorage sessions', async () => {
  const timestamp = Date.now();
  const signature = await generateHmacSignature(
    localStorageSessionPayload('user', timestamp),
    secret,
  );
  const tamperedSignature = `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`;

  assert.equal(
    await isValidLocalStorageSession(
      { role: 'owner', timestamp, signature },
      secret,
      timestamp,
    ),
    false,
  );
  assert.equal(
    await isValidLocalStorageSession(
      { role: 'user', timestamp, signature: tamperedSignature },
      secret,
      timestamp,
    ),
    false,
  );
  assert.equal(
    await isValidLocalStorageSession(
      { role: 'user', timestamp, signature },
      secret,
      timestamp + 8 * 24 * 60 * 60 * 1000,
    ),
    false,
  );
});

test('user sessions bind username, role and issue time', async () => {
  const timestamp = Date.now();
  const signature = await generateHmacSignature(
    userSessionPayload('alice', 'user', timestamp),
    secret,
  );
  assert.equal(
    await isValidUserSession(
      { username: 'alice', role: 'user', timestamp, signature },
      secret,
    ),
    true,
  );
  assert.equal(
    await isValidUserSession(
      { username: 'alice', role: 'admin', timestamp, signature },
      secret,
    ),
    false,
  );
  assert.equal(
    await isValidUserSession(
      {
        username: 'alice',
        role: 'user',
        timestamp,
        signature: await generateHmacSignature('alice', secret),
      },
      secret,
    ),
    false,
  );
});
