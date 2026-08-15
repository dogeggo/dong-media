export const DEFAULT_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS = 10;
export const MAX_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS = 100_000;

const SECONDS_PER_HOUR = 60 * 60;

/**
 * 规范化非活跃用户清理的播放时长保护阈值。
 *
 * 允许配置为 0（任何大于 0 的累计播放时长都会受到保护），并限制为最多
 * 两位小数，避免异常配置导致比较结果不可预测。
 */
export function normalizeInactiveUserCleanupExemptWatchHours(
  value: unknown,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS;
  }

  const clampedValue = Math.min(
    MAX_INACTIVE_USER_CLEANUP_EXEMPT_WATCH_HOURS,
    Math.max(0, value),
  );
  return Math.round(clampedValue * 100) / 100;
}

/**
 * 累计播放时长严格大于配置阈值时，用户不参与非活跃清理。
 */
export function isInactiveUserExemptFromCleanup(
  totalWatchTimeSeconds: unknown,
  configuredHours: unknown,
): boolean {
  if (
    typeof totalWatchTimeSeconds !== 'number' ||
    !Number.isFinite(totalWatchTimeSeconds) ||
    totalWatchTimeSeconds < 0
  ) {
    return false;
  }

  const thresholdHours =
    normalizeInactiveUserCleanupExemptWatchHours(configuredHours);
  return totalWatchTimeSeconds > thresholdHours * SECONDS_PER_HOUR;
}
