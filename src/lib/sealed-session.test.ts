import assert from 'node:assert/strict';
import test from 'node:test';

import { sealSession, unsealSession } from './sealed-session.ts';

test('sealed sessions are confidential, authenticated and purpose-bound', () => {
  const token = sealSession(
    { sub: 'user-123', timestamp: 1 },
    'oidc-registration',
    'test-secret',
  );
  assert.equal(token.includes('user-123'), false);
  assert.deepEqual(unsealSession(token, 'oidc-registration', 'test-secret'), {
    sub: 'user-123',
    timestamp: 1,
  });
  assert.equal(unsealSession(token, 'oidc-state', 'test-secret'), null);
  const parts = token.split('.');
  parts[1] = `${parts[1][0] === 'a' ? 'b' : 'a'}${parts[1].slice(1)}`;
  assert.equal(
    unsealSession(parts.join('.'), 'oidc-registration', 'test-secret'),
    null,
  );
});
