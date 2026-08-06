/* eslint-disable no-console */

import { noStoreResponseHeaders } from '@/lib/cache-system';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4_096;
const METRIC_NAMES = new Set(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
const RATINGS = new Set(['good', 'needs-improvement', 'poor']);

interface WebVitalPayload {
  delta: number;
  device: 'desktop' | 'mobile';
  effectiveType?: string;
  id: string;
  name: string;
  navigationType?: string;
  path: string;
  rating: string;
  release: string;
  saveData: boolean;
  value: number;
}

function isValidMetric(payload: unknown): payload is WebVitalPayload {
  if (!payload || typeof payload !== 'object') return false;
  const metric = payload as Partial<WebVitalPayload>;
  return (
    typeof metric.id === 'string' &&
    metric.id.length > 0 &&
    metric.id.length <= 128 &&
    typeof metric.name === 'string' &&
    METRIC_NAMES.has(metric.name) &&
    typeof metric.value === 'number' &&
    Number.isFinite(metric.value) &&
    metric.value >= 0 &&
    typeof metric.delta === 'number' &&
    Number.isFinite(metric.delta) &&
    typeof metric.path === 'string' &&
    metric.path.startsWith('/') &&
    metric.path.length <= 256 &&
    (metric.device === 'desktop' || metric.device === 'mobile') &&
    typeof metric.rating === 'string' &&
    RATINGS.has(metric.rating) &&
    typeof metric.release === 'string' &&
    metric.release.length <= 128 &&
    typeof metric.saveData === 'boolean' &&
    (metric.effectiveType === undefined ||
      (typeof metric.effectiveType === 'string' &&
        metric.effectiveType.length <= 32)) &&
    (metric.navigationType === undefined ||
      (typeof metric.navigationType === 'string' &&
        metric.navigationType.length <= 64))
  );
}

export async function POST(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    return new Response(null, {
      status: 403,
      headers: noStoreResponseHeaders(),
    });
  }

  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return new Response(null, {
      status: 413,
      headers: noStoreResponseHeaders(),
    });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response(null, {
      status: 400,
      headers: noStoreResponseHeaders(),
    });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return new Response(null, {
      status: 413,
      headers: noStoreResponseHeaders(),
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, {
      status: 400,
      headers: noStoreResponseHeaders(),
    });
  }
  if (!isValidMetric(payload)) {
    return new Response(null, {
      status: 400,
      headers: noStoreResponseHeaders(),
    });
  }

  console.info(
    '[web-vitals]',
    JSON.stringify({
      ...payload,
      country:
        request.headers.get('cf-ipcountry') ||
        request.headers.get('x-vercel-ip-country') ||
        'unknown',
      timestamp: new Date().toISOString(),
    }),
  );

  return new Response(null, {
    status: 204,
    headers: noStoreResponseHeaders(),
  });
}
