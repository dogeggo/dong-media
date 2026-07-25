import {
  createLocalJWKSet,
  type JSONWebKeySet,
  type JWTPayload,
  jwtVerify,
} from 'jose';

import type { AdminConfig } from '@/lib/admin.types';
import { safeFetch } from '@/lib/safe-upstream-url';

export type OidcProvider = NonNullable<AdminConfig['OIDCProviders']>[number];

interface OidcDiscoveryDocument {
  issuer: string;
  jwks_uri: string;
}

async function readJsonWithLimit(response: Response, maxBytes = 1024 * 1024) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error('OIDC response is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    throw new Error('OIDC response is too large');
  }
  return JSON.parse(text) as unknown;
}

export async function fetchJsonWithLimit(
  input: string,
  options: Parameters<typeof safeFetch>[1] = {},
  maxBytes = 1024 * 1024,
) {
  const response = await safeFetch(input, options);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`OIDC endpoint returned HTTP ${response.status}`);
  }
  return readJsonWithLimit(response as unknown as Response, maxBytes);
}

export function isOauthOnlyProvider(providerId: string) {
  return ['facebook', 'github', 'wechat'].includes(providerId);
}

export async function verifyOidcIdToken(options: {
  idToken: string;
  provider: OidcProvider;
  nonce: string;
}): Promise<JWTPayload> {
  const issuer = options.provider.issuer.trim().replace(/\/$/, '');
  if (!issuer) throw new Error('OIDC issuer is required');

  const discovery = (await fetchJsonWithLimit(
    `${issuer}/.well-known/openid-configuration`,
    { maxRedirects: 2, cache: 'no-store' },
  )) as OidcDiscoveryDocument;
  if (
    !discovery.issuer ||
    !discovery.jwks_uri ||
    discovery.issuer.replace(/\/$/, '') !== issuer
  ) {
    throw new Error('OIDC discovery metadata is invalid');
  }

  const jwks = (await fetchJsonWithLimit(discovery.jwks_uri, {
    maxRedirects: 2,
    cache: 'no-store',
  })) as JSONWebKeySet;

  const result = await jwtVerify(options.idToken, createLocalJWKSet(jwks), {
    issuer: discovery.issuer,
    audience: options.provider.clientId,
    clockTolerance: 5,
    maxTokenAge: '10m',
  });
  if (result.payload.nonce !== options.nonce) {
    throw new Error('OIDC nonce validation failed');
  }
  return result.payload;
}
