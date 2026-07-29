import { createHash } from 'node:crypto';

import type { CachePolicy } from './types.ts';

type JsonPrimitive = string | number | boolean | null;
type StableValue =
  | JsonPrimitive
  | StableValue[]
  | { [key: string]: StableValue };

function normalizeValue(value: unknown): StableValue {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return String(value);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function hashCacheValue(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

export function normalizeQuery(value: string, caseInsensitive = true): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return caseInsensitive ? normalized.toLocaleLowerCase() : normalized;
}

export function hasOnlyUniqueSearchParams(
  searchParams: URLSearchParams,
  allowedNames: readonly string[],
): boolean {
  const allowed = new Set(allowedNames);
  const seen = new Set<string>();
  for (const [name] of searchParams) {
    if (!allowed.has(name) || seen.has(name)) return false;
    seen.add(name);
  }
  return true;
}

export function normalizeSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
  url.searchParams.sort();
  return url.toString();
}

export function getCacheEnvironmentName(): string {
  const raw =
    process.env.CACHE_ENVIRONMENT || process.env.NODE_ENV || 'development';
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

export function buildCacheKey(
  policy: CachePolicy,
  params: unknown,
  options: { scope?: string; generation?: number } = {},
): string {
  if (policy.scope === 'user' && !options.scope) {
    throw new Error(`Cache policy ${policy.namespace} requires a user scope`);
  }

  const scopeHash = hashCacheValue(
    policy.scope === 'public'
      ? 'public'
      : policy.scope === 'system'
        ? 'system'
        : options.scope,
  ).slice(0, 24);
  const paramsHash = hashCacheValue(params).slice(0, 48);
  const generation = Math.max(1, options.generation || 1);

  return [
    'dm',
    'v2',
    getCacheEnvironmentName(),
    policy.namespace,
    `p${policy.version}`,
    `g${generation}`,
    scopeHash,
    paramsHash,
  ].join(':');
}

export function buildGenerationKey(namespace: string): string {
  return `dm:gen:${getCacheEnvironmentName()}:${namespace}`;
}
