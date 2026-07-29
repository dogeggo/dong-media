import { createHash } from 'node:crypto';

import { STATIC_MEDIA_TTL_SECONDS } from '../http.ts';

export const MEDIA_TTL_MS = STATIC_MEDIA_TTL_SECONDS * 1_000;

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'application/ogg',
]);
const SENSITIVE_QUERY_NAMES = new Set([
  'auth',
  'auth_key',
  'expires',
  'hdnts',
  'key',
  'key-pair-id',
  'policy',
  'sig',
  'signature',
  'token',
  'wssecret',
  'wstime',
  'x-amz-credential',
  'x-amz-signature',
  'x-goog-credential',
  'x-goog-signature',
]);

export type MediaKind = 'image' | 'video';

export function normalizeMediaContentType(value: string | null): string {
  return (value || '').split(';', 1)[0].trim().toLowerCase();
}

export function isAllowedMediaContentType(
  kind: MediaKind,
  value: string | null,
): boolean {
  const normalized = normalizeMediaContentType(value);
  return (kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES).has(normalized);
}

export function createMediaEtag(data: Uint8Array): string {
  return `"${createHash('sha256').update(data).digest('hex')}"`;
}

export function hasSensitiveMediaParams(url: URL | string): boolean {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  return Array.from(parsed.searchParams.keys()).some((name) =>
    SENSITIVE_QUERY_NAMES.has(name.toLowerCase()),
  );
}

export function mediaBody(data: Uint8Array): ArrayBuffer {
  const buffer = data.buffer as ArrayBuffer;
  return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

interface ByteStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

interface ByteStreamBody {
  getReader(): ByteStreamReader;
}

export async function readBodyWithLimit(
  response: { body: unknown },
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Invalid response body size limit');
  }
  const body = response.body as ByteStreamBody | null;
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError('Response body exceeds the configured limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface ByteRange {
  start: number;
  end: number;
}

export function parseSingleRange(
  value: string | null,
  size: number,
): ByteRange | null | 'invalid' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return 'invalid';

  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return 'invalid';

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return 'invalid';
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return 'invalid';
  }
  return { start, end: Math.min(end, size - 1) };
}

export function isNotModified(
  request: Request,
  metadata: { etag?: string; lastModified?: string },
): boolean {
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) {
    const candidates = ifNoneMatch.split(',').map((value) => value.trim());
    if (candidates.includes('*')) return true;
    if (!metadata.etag) return false;
    const current = weakEtagValue(metadata.etag);
    return candidates.some((value) => weakEtagValue(value) === current);
  }
  const ifModifiedSince = request.headers.get('if-modified-since');
  if (!ifModifiedSince || !metadata.lastModified) return false;
  const requestedTime = Date.parse(ifModifiedSince);
  const modifiedTime = Date.parse(metadata.lastModified);
  return (
    Number.isFinite(requestedTime) &&
    Number.isFinite(modifiedTime) &&
    modifiedTime <= requestedTime
  );
}

export function hasFailedPreconditions(
  request: Request,
  metadata: { etag?: string; lastModified?: string },
): boolean {
  const ifMatch = request.headers.get('if-match');
  if (ifMatch) {
    const candidates = ifMatch.split(',').map((value) => value.trim());
    if (!candidates.includes('*')) {
      if (!metadata.etag || metadata.etag.startsWith('W/')) return true;
      const matched = candidates.some(
        (value) => !value.startsWith('W/') && value === metadata.etag,
      );
      if (!matched) return true;
    }
    return false;
  }

  const ifUnmodifiedSince = request.headers.get('if-unmodified-since');
  if (!ifUnmodifiedSince || !metadata.lastModified) return false;
  const requestedTime = Date.parse(ifUnmodifiedSince);
  const modifiedTime = Date.parse(metadata.lastModified);
  return (
    Number.isFinite(requestedTime) &&
    Number.isFinite(modifiedTime) &&
    modifiedTime > requestedTime
  );
}

export function isIfRangeMatch(
  request: Request,
  metadata: { etag?: string; lastModified?: string },
): boolean {
  const ifRange = request.headers.get('if-range')?.trim();
  if (!ifRange) return true;
  if (ifRange.startsWith('"') || ifRange.startsWith('W/')) {
    return Boolean(
      metadata.etag &&
      !ifRange.startsWith('W/') &&
      !metadata.etag.startsWith('W/') &&
      ifRange === metadata.etag,
    );
  }
  if (!metadata.lastModified) return false;
  const requestedTime = Date.parse(ifRange);
  const modifiedTime = Date.parse(metadata.lastModified);
  return (
    Number.isFinite(requestedTime) &&
    Number.isFinite(modifiedTime) &&
    modifiedTime <= requestedTime
  );
}

function weakEtagValue(value: string): string {
  return value.replace(/^W\//i, '');
}
