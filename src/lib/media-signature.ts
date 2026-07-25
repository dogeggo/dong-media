import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = DEFAULT_LIFETIME_MS + 5 * 60 * 1000;

export type MediaSignatureScope = 'm3u8' | 'segment' | 'key';

function getSigningSecret(): string {
  const secret = process.env.MEDIA_PROXY_SECRET || process.env.PASSWORD;
  if (!secret) {
    throw new Error('MEDIA_PROXY_SECRET or PASSWORD must be configured');
  }
  return secret;
}

function payload(
  scope: MediaSignatureScope,
  source: string,
  url: string,
  expires: number,
) {
  return `media:${scope}:${source}:${expires}:${url}`;
}

export function signMediaUrl(
  scope: MediaSignatureScope,
  source: string,
  url: string,
  expires = Date.now() + DEFAULT_LIFETIME_MS,
) {
  return {
    expires,
    signature: createHmac('sha256', getSigningSecret())
      .update(payload(scope, source, url, expires))
      .digest('hex'),
  };
}

export function verifyMediaUrlSignature(options: {
  scope: MediaSignatureScope;
  source: string;
  url: string;
  expires: string | null;
  signature: string | null;
  now?: number;
}) {
  const expires = Number(options.expires);
  const now = options.now ?? Date.now();
  if (
    !Number.isSafeInteger(expires) ||
    expires <= now ||
    expires > now + MAX_FUTURE_MS ||
    !options.signature ||
    !/^[a-f\d]{64}$/i.test(options.signature)
  ) {
    return false;
  }

  const expected = createHmac('sha256', getSigningSecret())
    .update(payload(options.scope, options.source, options.url, expires))
    .digest();
  const supplied = Buffer.from(options.signature, 'hex');
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function createSignedMediaProxyUrl(options: {
  origin: string;
  scope: MediaSignatureScope;
  source: string;
  targetUrl: string;
  lifetimeMs?: number;
}) {
  const expires = Date.now() + (options.lifetimeMs || DEFAULT_LIFETIME_MS);
  const { signature } = signMediaUrl(
    options.scope,
    options.source,
    options.targetUrl,
    expires,
  );
  const proxyUrl = new URL(`/api/proxy/${options.scope}`, options.origin);
  proxyUrl.searchParams.set('url', options.targetUrl);
  proxyUrl.searchParams.set('moontv-source', options.source);
  proxyUrl.searchParams.set('expires', String(expires));
  proxyUrl.searchParams.set('signature', signature);
  return proxyUrl.toString();
}
