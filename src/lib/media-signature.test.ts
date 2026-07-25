import assert from 'node:assert/strict';
import test from 'node:test';

import { signMediaUrl, verifyMediaUrlSignature } from './media-signature.ts';

test('media signatures bind scope, source, URL and expiration', () => {
  const originalSecret = process.env.MEDIA_PROXY_SECRET;
  process.env.MEDIA_PROXY_SECRET = 'test-media-signing-secret';
  try {
    const now = 1_700_000_000_000;
    const expires = now + 60_000;
    const signed = signMediaUrl(
      'segment',
      'live-source',
      'https://cdn.example.com/a.ts',
      expires,
    );
    assert.equal(
      verifyMediaUrlSignature({
        scope: 'segment',
        source: 'live-source',
        url: 'https://cdn.example.com/a.ts',
        expires: String(expires),
        signature: signed.signature,
        now,
      }),
      true,
    );
    assert.equal(
      verifyMediaUrlSignature({
        scope: 'key',
        source: 'live-source',
        url: 'https://cdn.example.com/a.ts',
        expires: String(expires),
        signature: signed.signature,
        now,
      }),
      false,
    );
  } finally {
    if (originalSecret === undefined) delete process.env.MEDIA_PROXY_SECRET;
    else process.env.MEDIA_PROXY_SECRET = originalSecret;
  }
});
