'use client';

import { useReportWebVitals } from 'next/web-vitals';

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
}

function reportWebVital(
  metric: Parameters<typeof useReportWebVitals>[0] extends (
    metric: infer T,
  ) => void
    ? T
    : never,
) {
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection;
  const payload = JSON.stringify({
    delta: metric.delta,
    device: window.matchMedia('(max-width: 767px)').matches
      ? 'mobile'
      : 'desktop',
    effectiveType: connection?.effectiveType,
    id: metric.id,
    name: metric.name,
    navigationType: metric.navigationType,
    path: window.location.pathname,
    rating: metric.rating,
    release:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_APP_VERSION ||
      'unknown',
    saveData: connection?.saveData === true,
    value: metric.value,
  });

  if (navigator.sendBeacon?.('/api/web-vitals', payload)) return;
  void fetch('/api/web-vitals', {
    body: payload,
    keepalive: true,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}
