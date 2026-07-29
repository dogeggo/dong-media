import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hostnameMatchesAllowlist,
  isBlockedIpAddress,
  isExecutableDocumentContentType,
  parseSafeHttpUrl,
  withResponseHeadersTimeout,
} from './safe-upstream-url.ts';

test('blocks private, reserved and metadata addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:192.168.1.1',
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }
  assert.equal(isBlockedIpAddress('1.1.1.1'), false);
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);
});

test('accepts only HTTP(S), public hosts and explicit host allowlists', () => {
  assert.throws(() => parseSafeHttpUrl('file:///etc/passwd'));
  assert.throws(() => parseSafeHttpUrl('http://127.0.0.1/admin'));
  assert.throws(() => parseSafeHttpUrl('https://user:pass@example.com'));
  assert.throws(() =>
    parseSafeHttpUrl('https://example.com', ['video.example.net']),
  );
  assert.equal(
    parseSafeHttpUrl('https://cdn.video.example.net/a.m3u8', [
      'video.example.net',
    ]).hostname,
    'cdn.video.example.net',
  );
});

test('host allowlist matching does not accept suffix confusion', () => {
  assert.equal(hostnameMatchesAllowlist('v.qq.com', ['qq.com']), true);
  assert.equal(
    hostnameMatchesAllowlist('qq.com.evil.example', ['qq.com']),
    false,
  );
});

test('detects executable document response types', () => {
  assert.equal(
    isExecutableDocumentContentType('text/html; charset=utf-8'),
    true,
  );
  assert.equal(isExecutableDocumentContentType('image/svg+xml'), true);
  assert.equal(isExecutableDocumentContentType('video/mp4'), false);
});

test('aborts an upstream operation that does not return headers in time', async () => {
  await assert.rejects(
    withResponseHeadersTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
      10,
    ),
    (error: Error) => error.name === 'AbortError',
  );
});

test('does not abort a streamed body after response headers arrive', async () => {
  const response = await withResponseHeadersTimeout(async (signal) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener(
          'abort',
          () => controller.error(signal.reason),
          { once: true },
        );
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('stream completed'));
          controller.close();
        }, 25);
      },
    });
    return new Response(body);
  }, 10);

  assert.equal(await response.text(), 'stream completed');
});
