import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSignedMediaProxyPath,
  createSignedMediaProxyUrl,
  signMediaUrl,
  verifyMediaUrlSignature,
} from './media-signature.ts';

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

test('signed media proxy paths remain relative to the browser origin', () => {
  const originalSecret = process.env.MEDIA_PROXY_SECRET;
  process.env.MEDIA_PROXY_SECRET = 'test-media-signing-secret';
  try {
    const options = {
      scope: 'm3u8' as const,
      source: 'live-source',
      targetUrl: 'http://media.example.com/live/master.m3u8?token=value',
      lifetimeMs: 60_000,
    };
    const path = createSignedMediaProxyPath(options);
    const parsedPath = new URL(path, 'https://viewer.example.com');

    assert.match(path, /^\/api\/proxy\/m3u8\?/);
    assert.equal(parsedPath.origin, 'https://viewer.example.com');
    assert.equal(parsedPath.searchParams.get('url'), options.targetUrl);
    assert.equal(parsedPath.searchParams.get('moontv-source'), options.source);
    assert.ok(parsedPath.searchParams.get('expires'));
    assert.match(
      parsedPath.searchParams.get('signature') || '',
      /^[a-f\d]{64}$/,
    );

    const absoluteUrl = createSignedMediaProxyUrl({
      ...options,
      origin: 'https://public.example.com',
    });
    assert.equal(new URL(absoluteUrl).origin, 'https://public.example.com');
  } finally {
    if (originalSecret === undefined) delete process.env.MEDIA_PROXY_SECRET;
    else process.env.MEDIA_PROXY_SECRET = originalSecret;
  }
});
