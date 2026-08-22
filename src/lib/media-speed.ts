interface HlsLoadTimingLike {
  start?: number;
  first?: number;
  end?: number;
}

interface HlsLoadStatsLike {
  loaded?: number;
  total?: number;
  loading?: HlsLoadTimingLike;
}

interface HlsFragmentLike {
  sn?: number | string;
  stats?: HlsLoadStatsLike;
  type?: string;
}

interface HlsPartLike {
  stats?: HlsLoadStatsLike;
}

export interface HlsFragmentLoadDataLike {
  frag?: HlsFragmentLike;
  part?: HlsPartLike | null;
  payload?: { byteLength?: number } | null;
  stats?: HlsLoadStatsLike;
}

export interface TransferSpeedSample {
  durationMs: number;
  loadedBytes: number;
}

function getPositiveFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Only video/media fragments are useful throughput samples. Init segments and
 * alternate audio are generally much smaller and would skew the result.
 */
export function isMeasurableMediaFragment(
  data: HlsFragmentLoadDataLike,
): boolean {
  const fragment = data.frag;
  if (!fragment) return false;
  if (fragment.sn === 'initSegment') return false;
  return !fragment.type || fragment.type === 'main';
}

/**
 * Extracts the bytes and actual transfer duration from an hls.js fragment.
 * Prefer first-byte -> last-byte so server latency is not reported as download
 * speed. The request/event duration is only a compatibility fallback.
 */
export function getHlsTransferSpeedSample(
  data: HlsFragmentLoadDataLike,
  fallbackStartTime = 0,
  completedAt = 0,
): TransferSpeedSample | null {
  const stats = data.part?.stats || data.frag?.stats || data.stats;
  const loadedBytes = getPositiveFiniteNumber(
    stats?.loaded,
    stats?.total,
    data.payload?.byteLength,
  );
  if (!loadedBytes) return null;

  const start = stats?.loading?.start;
  const first = stats?.loading?.first;
  const end = stats?.loading?.end;

  const transferDurationMs =
    typeof first === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(first) &&
    Number.isFinite(end) &&
    end > first
      ? end - first
      : null;
  const requestDurationMs =
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start
      ? end - start
      : null;
  const eventDurationMs =
    Number.isFinite(fallbackStartTime) &&
    Number.isFinite(completedAt) &&
    fallbackStartTime > 0 &&
    completedAt > fallbackStartTime
      ? completedAt - fallbackStartTime
      : null;
  const durationMs = transferDurationMs || requestDurationMs || eventDurationMs;

  if (!durationMs) return null;
  return { durationMs, loadedBytes };
}

/**
 * Calculates aggregate throughput. Weighting by bytes and elapsed time avoids
 * small fragments having the same influence as full video fragments.
 */
export function calculateTransferSpeedBytesPerSecond(
  samples: readonly TransferSpeedSample[],
): number | null {
  let totalBytes = 0;
  let totalDurationMs = 0;

  for (const sample of samples) {
    if (
      Number.isFinite(sample.loadedBytes) &&
      Number.isFinite(sample.durationMs) &&
      sample.loadedBytes > 0 &&
      sample.durationMs > 0
    ) {
      totalBytes += sample.loadedBytes;
      totalDurationMs += sample.durationMs;
    }
  }

  if (totalBytes <= 0 || totalDurationMs <= 0) return null;
  return (totalBytes * 1000) / totalDurationMs;
}

export function formatTransferSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '未知';

  const kibibytesPerSecond = bytesPerSecond / 1024;
  return kibibytesPerSecond >= 1024
    ? `${(kibibytesPerSecond / 1024).toFixed(2)} MB/s`
    : `${kibibytesPerSecond.toFixed(2)} KB/s`;
}
