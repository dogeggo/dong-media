import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import {
  Agent,
  fetch as undiciFetch,
  Headers as UndiciHeaders,
  type RequestInit,
} from 'undici';

const MAX_URL_LENGTH = 8192;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class UnsafeUpstreamUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUpstreamUrlError';
  }
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    result = (result << 8) | value;
  }

  return result >>> 0;
}

function isIpv4InCidr(address: number, network: string, prefix: number) {
  const networkNumber = ipv4ToNumber(network);
  if (networkNumber === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (networkNumber & mask);
}

function isBlockedIpv4(address: string): boolean {
  const numeric = ipv4ToNumber(address);
  if (numeric === null) return true;

  const blockedCidrs: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];

  return blockedCidrs.some(([network, prefix]) =>
    isIpv4InCidr(numeric, network, prefix),
  );
}

function parseIpv6Hextets(input: string): number[] | null {
  let address = input.toLowerCase().split('%')[0];
  const embeddedIpv4 = address.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];

  if (embeddedIpv4) {
    const ipv4 = ipv4ToNumber(embeddedIpv4);
    if (ipv4 === null) return null;
    address = address.replace(
      embeddedIpv4,
      `${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`,
    );
  }

  const compressionParts = address.split('::');
  if (compressionParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const values = side.split(':').map((part) => {
      if (!/^[a-f\d]{1,4}$/.test(part)) return Number.NaN;
      return Number.parseInt(part, 16);
    });
    return values.some(Number.isNaN) ? null : values;
  };

  const left = parseSide(compressionParts[0]);
  const right = parseSide(compressionParts[1] || '');
  if (!left || !right) return null;

  if (compressionParts.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function isBlockedIpv6(address: string): boolean {
  const hextets = parseIpv6Hextets(address);
  if (!hextets) return true;

  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = hextets;
  const allZero = hextets.every((value) => value === 0);
  const loopback =
    hextets.slice(0, 7).every((value) => value === 0) && eighth === 1;
  if (allZero || loopback) return true;

  const isIpv4Mapped =
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0xffff;
  if (isIpv4Mapped) {
    const mapped = `${seventh >>> 8}.${seventh & 0xff}.${eighth >>> 8}.${eighth & 0xff}`;
    return isBlockedIpv4(mapped);
  }

  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  if (first === 0x2001 && second === 0x0000) return true; // Teredo
  if (first === 0x2002) return true; // 6to4
  if (first === 0x0064 && second === 0xff9b) return true; // NAT64 well-known prefix
  if (
    first === 0x2001 &&
    (second === 0x0002 ||
      (second >= 0x0010 && second <= 0x001f) ||
      (second >= 0x0020 && second <= 0x002f))
  ) {
    return true;
  }

  return false;
}

export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address.split('%')[0]);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export function hostnameMatchesAllowlist(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowed = allowedHost
      .toLowerCase()
      .replace(/^\*\./, '')
      .replace(/\.$/, '');
    return (
      normalizedHostname === normalizedAllowed ||
      normalizedHostname.endsWith(`.${normalizedAllowed}`)
    );
  });
}

export function parseSafeHttpUrl(
  input: string,
  allowedHosts?: readonly string[],
): URL {
  if (!input || input.length > MAX_URL_LENGTH) {
    throw new UnsafeUpstreamUrlError('URL is missing or too long');
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUpstreamUrlError('URL is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUpstreamUrlError('Only HTTP and HTTPS URLs are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeUpstreamUrlError('URL credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new UnsafeUpstreamUrlError('Local hostnames are not allowed');
  }

  if (isIP(hostname) && isBlockedIpAddress(hostname)) {
    throw new UnsafeUpstreamUrlError(
      'Private or reserved IP addresses are not allowed',
    );
  }
  if (allowedHosts && !hostnameMatchesAllowlist(hostname, allowedHosts)) {
    throw new UnsafeUpstreamUrlError('Target hostname is not allowed');
  }

  return url;
}

async function assertPublicDns(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new UnsafeUpstreamUrlError(
        'Private or reserved IP addresses are not allowed',
      );
    }
    return;
  }

  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new UnsafeUpstreamUrlError('Target hostname did not resolve');
  }
  if (addresses.some(({ address }) => isBlockedIpAddress(address))) {
    throw new UnsafeUpstreamUrlError(
      'Target hostname resolves to a private or reserved address',
    );
  }
}

const safeLookup = ((
  hostname: string,
  options: { family?: number; all?: boolean },
  callback: (...args: unknown[]) => void,
) => {
  dnsLookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      if (
        addresses.length === 0 ||
        addresses.some(({ address }) => isBlockedIpAddress(address))
      ) {
        callback(
          new UnsafeUpstreamUrlError(
            'Target hostname resolves to a private or reserved address',
          ),
        );
        return;
      }

      const requestedFamily = Number(options?.family || 0);
      const candidates = requestedFamily
        ? addresses.filter(({ family }) => family === requestedFamily)
        : addresses;
      const selected = candidates[0] || addresses[0];

      if (options?.all) {
        callback(null, candidates.length > 0 ? candidates : addresses);
      } else {
        callback(null, selected.address, selected.family);
      }
    })
    .catch((error) => callback(error));
}) as LookupFunction;

const safeDispatcher = new Agent({
  connect: {
    lookup: safeLookup,
  },
});

export interface SafeFetchOptions extends RequestInit {
  allowedHosts?: readonly string[];
  maxRedirects?: number;
}

/**
 * Limits how long an upstream request may take to return its response headers.
 *
 * The timer is cleared as soon as the operation resolves. This distinction is
 * important for callers that return the response body as a stream: using
 * `AbortSignal.timeout()` directly would also abort that body when the timer
 * expires, even though the upstream connection was established successfully.
 * An optional caller signal remains active after the headers arrive so client
 * disconnects can still cancel the streamed body.
 */
export async function withResponseHeadersTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Response headers timeout must be positive');
  }

  const timeoutController = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    return await operation(signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}) {
  const { allowedHosts, maxRedirects = 5, ...requestOptions } = options;
  let currentUrl = parseSafeHttpUrl(input, allowedHosts);
  let method = (requestOptions.method || 'GET').toUpperCase();
  let body = requestOptions.body;
  let headers = new UndiciHeaders(requestOptions.headers);

  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertPublicDns(currentUrl.hostname);

    const response = await undiciFetch(currentUrl, {
      ...requestOptions,
      method,
      body,
      headers,
      redirect: 'manual',
      dispatcher: safeDispatcher,
    });

    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return response;
    }
    if (redirectCount >= maxRedirects) {
      await response.body?.cancel();
      throw new UnsafeUpstreamUrlError('Too many upstream redirects');
    }

    const nextUrl = parseSafeHttpUrl(
      new URL(location, currentUrl).toString(),
      allowedHosts,
    );
    if (nextUrl.origin !== currentUrl.origin) {
      headers = new UndiciHeaders(headers);
      headers.delete('authorization');
      headers.delete('cookie');
      headers.delete('proxy-authorization');
    }

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method === 'POST')
    ) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
      headers.delete('content-length');
    }

    await response.body?.cancel();
    currentUrl = nextUrl;
  }
}

export function isExecutableDocumentContentType(contentType: string | null) {
  const normalized = (contentType || '').split(';', 1)[0].trim().toLowerCase();
  return (
    normalized === 'text/html' ||
    normalized === 'application/xhtml+xml' ||
    normalized === 'application/xml' ||
    normalized === 'text/xml' ||
    normalized === 'image/svg+xml' ||
    normalized === 'text/javascript' ||
    normalized === 'application/javascript' ||
    normalized === 'application/ecmascript' ||
    normalized === 'text/ecmascript'
  );
}
