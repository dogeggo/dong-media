import type { CachePolicy } from './types.ts';

export const STATIC_MEDIA_TTL_SECONDS = 604_800;

export interface PublicApiResponseOptions {
  initial?: HeadersInit;
  ttlSeconds?: number;
  negative?: boolean;
}

export function noStoreResponseHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  return headers;
}

export function privateResponseHeaders(
  seconds?: number,
  initial?: HeadersInit,
): Headers {
  if (!seconds || seconds <= 0) return noStoreResponseHeaders(initial);
  const headers = new Headers(initial);
  headers.set('Cache-Control', `private, max-age=${Math.floor(seconds)}`);
  return headers;
}

export function publicApiResponseHeaders(
  policy: CachePolicy,
  options: PublicApiResponseOptions = {},
): Headers {
  if (policy.scope !== 'public' || !policy.layers.includes('cdn')) {
    throw new Error(
      `Policy ${policy.namespace} cannot be used for shared HTTP caching`,
    );
  }
  const headers = new Headers(options.initial);
  const policyFresh = Math.max(0, Math.floor(policy.freshTtlSeconds));
  const fresh = Math.min(
    policyFresh,
    Math.max(0, Math.floor(options.ttlSeconds ?? policyFresh)),
  );
  const stale =
    options.negative || (options.ttlSeconds !== undefined && fresh === 0)
      ? 0
      : Math.max(0, Math.floor(policy.staleTtlSeconds ?? policyFresh));
  headers.set(
    'Cache-Control',
    `public, max-age=0, s-maxage=${fresh}, stale-while-revalidate=${stale}`,
  );
  return headers;
}

export function staticMediaResponseHeaders(
  options: { contentAddressed?: boolean; ttlSeconds?: number } = {},
  initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  const ttl = Math.min(
    STATIC_MEDIA_TTL_SECONDS,
    Math.max(0, Math.floor(options.ttlSeconds ?? STATIC_MEDIA_TTL_SECONDS)),
  );
  headers.set(
    'Cache-Control',
    `public, max-age=${ttl}, s-maxage=${ttl}${
      options.contentAddressed ? ', immutable' : ''
    }`,
  );
  return headers;
}

export function conditionalResponseHeaders(
  metadata: { etag?: string; lastModified?: string | Date },
  initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  if (metadata.etag) headers.set('ETag', metadata.etag);
  if (metadata.lastModified) {
    headers.set(
      'Last-Modified',
      metadata.lastModified instanceof Date
        ? metadata.lastModified.toUTCString()
        : metadata.lastModified,
    );
  }
  return headers;
}

export function applyNoStore(response: Response): Response {
  const headers = noStoreResponseHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
