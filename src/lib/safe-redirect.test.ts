import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeLoginRedirect,
  sanitizeInternalRedirect,
} from './safe-redirect.ts';

test('allows a normal same-site play URL', () => {
  assert.equal(
    sanitizeInternalRedirect(
      '/play?title=%E4%B8%80%E5%BF%B5%E6%B0%B8%E6%81%92&year=2026',
    ),
    '/play?title=%E4%B8%80%E5%BF%B5%E6%B0%B8%E6%81%92&year=2026',
  );
});

test('rejects external and executable redirect targets', () => {
  assert.equal(sanitizeInternalRedirect('https://example.com/phishing'), '/');
  assert.equal(sanitizeInternalRedirect('//example.com/phishing'), '/');
  assert.equal(sanitizeInternalRedirect('/\\example.com/phishing'), '/');
  assert.equal(sanitizeInternalRedirect('javascript:alert(1)'), '/');
});

test('rejects redirects back to authentication and API routes', () => {
  assert.equal(sanitizeInternalRedirect('/login?redirect=/play'), '/');
  assert.equal(sanitizeInternalRedirect('/api/logout'), '/');
});

test('normalizes the reported Google Safe Browsing login URL', () => {
  const reportedUrl = new URL(
    'https://tv.dogegg.online/login?redirect=/play?title%3D%E4%B8%80%E5%BF%B5%E6%B0%B8%E6%81%92+%E5%AE%8C%E7%BB%93%E5%AD%A3%26year=2026&douban_id=37448094&stype=tv&stitle=%E4%B8%80%E5%BF%B5%E6%B0%B8%E6%81%92',
  );

  assert.equal(
    normalizeLoginRedirect(
      reportedUrl.searchParams.get('redirect'),
      reportedUrl.searchParams,
    ),
    '/play?title=%E4%B8%80%E5%BF%B5%E6%B0%B8%E6%81%92+%E5%AE%8C%E7%BB%93%E5%AD%A3&year=2026&douban_id=37448094&stype=tv&stitle=%E4%B8%80%E5%BF%B5%E6%B0%B8%E6%81%92',
  );
});
