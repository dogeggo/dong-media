import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNamespacedOidcSub,
  createOidcSub,
  isNamespacedOidcSub,
} from './oidc-sub.ts';

test('creates provider-namespaced OIDC subjects', () => {
  assert.equal(createOidcSub('linuxdo', 3383), 'linuxdo:3383');
  assert.equal(
    createOidcSub('google', '123456789012345678901'),
    'google:123456789012345678901',
  );
});

test('recognizes only provider-namespaced OIDC subjects', () => {
  assert.equal(isNamespacedOidcSub('linuxdo:3383'), true);
  assert.equal(isNamespacedOidcSub('3383'), false);
  assert.equal(isNamespacedOidcSub(':3383'), false);
  assert.equal(isNamespacedOidcSub('linuxdo:'), false);
});

test('rejects invalid OIDC subject components and legacy storage values', () => {
  assert.throws(() => createOidcSub('', '3383'), /Provider ID/);
  assert.throws(() => createOidcSub('linuxdo:legacy', '3383'), /Provider ID/);
  assert.throws(() => createOidcSub('linuxdo', ''), /用户标识/);
  assert.throws(() => assertNamespacedOidcSub('3383'), /Provider 前缀/);
  assert.equal(assertNamespacedOidcSub('linuxdo:3383'), 'linuxdo:3383');
});
