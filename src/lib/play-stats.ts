import type { PlayStatsResult, UserStat, UserStatsSnapshot } from './types.ts';

export interface PlayStatsUser {
  username: string;
  createdAt?: number;
}

interface BuildPlayStatsOptions {
  concurrency?: number;
  now?: number;
  onUserError?: (username: string, error: unknown) => void;
}

interface ProcessedUserStats {
  dailyData: Record<string, { watchTime: number; plays: number }>;
  sourceCount: Record<string, number>;
  userStat: UserStat;
}

export const DEFAULT_PLAY_STATS_CONCURRENCY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// 按自然日计算注册天数，注册当天记为第 1 天。
export function calculateRegistrationDays(
  startDate: number,
  currentTimestamp = Date.now(),
): number {
  if (!startDate || startDate <= 0) return 0;

  const firstDate = new Date(startDate);
  const currentDate = new Date(currentTimestamp);
  const firstDay = new Date(
    firstDate.getFullYear(),
    firstDate.getMonth(),
    firstDate.getDate(),
  );
  const currentDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  );

  return Math.floor((currentDay.getTime() - firstDay.getTime()) / DAY_MS) + 1;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency)),
  );
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0];
}

export async function buildPlayStats(
  users: readonly PlayStatsUser[],
  loadSnapshot: (username: string) => Promise<UserStatsSnapshot>,
  options: BuildPlayStatsOptions = {},
): Promise<PlayStatsResult> {
  const nowTimestamp = options.now ?? Date.now();
  const now = new Date(nowTimestamp);
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const sevenDaysAgoTime = nowTimestamp - 7 * DAY_MS;

  let todayNewUsers = 0;
  const registrationData: Record<string, number> = {};
  const userCreatedAt = new Map<string, number>();
  for (const user of users) {
    const createdAt = user.createdAt || nowTimestamp;
    userCreatedAt.set(user.username, createdAt);
    if (createdAt >= todayStart) todayNewUsers++;
    if (createdAt >= sevenDaysAgoTime) {
      const registrationDate = dateKey(createdAt);
      registrationData[registrationDate] =
        (registrationData[registrationDate] || 0) + 1;
    }
  }

  const processedUsers = await mapWithConcurrency(
    users,
    options.concurrency ?? DEFAULT_PLAY_STATS_CONCURRENCY,
    async (user): Promise<ProcessedUserStats | null> => {
      try {
        const snapshot = await loadSnapshot(user.username);
        const records = Object.values(snapshot.playRecords);
        const dailyData: ProcessedUserStats['dailyData'] = {};
        const sourceCount: ProcessedUserStats['sourceCount'] = {};

        for (const record of records) {
          if (record.save_time >= sevenDaysAgoTime) {
            const recordDate = dateKey(record.save_time);
            const dailyStat = (dailyData[recordDate] ||= {
              watchTime: 0,
              plays: 0,
            });
            dailyStat.watchTime += record.play_time || 0;
            dailyStat.plays += 1;
          }
          const sourceName = record.source_name || '未知来源';
          sourceCount[sourceName] = (sourceCount[sourceName] || 0) + 1;
        }

        const createdAt = userCreatedAt.get(user.username) || nowTimestamp;
        return {
          dailyData,
          sourceCount,
          userStat: {
            ...snapshot.userStat,
            username: user.username,
            registrationDays: calculateRegistrationDays(
              createdAt,
              nowTimestamp,
            ),
            createdAt,
          },
        };
      } catch (error) {
        options.onUserError?.(user.username, error);
        return null;
      }
    },
  );

  const userStats: UserStat[] = [];
  const sourceCount: Record<string, number> = {};
  const dailyData: Record<string, { watchTime: number; plays: number }> = {};
  let totalWatchTime = 0;
  let totalMovies = 0;
  let totalPlays = 0;

  for (const processed of processedUsers) {
    if (!processed) continue;
    const stat = processed.userStat;
    userStats.push(stat);
    totalWatchTime += stat.totalWatchTime || 0;
    totalMovies += stat.totalMovies || 0;
    totalPlays += stat.totalPlays || 0;

    for (const [source, count] of Object.entries(processed.sourceCount)) {
      sourceCount[source] = (sourceCount[source] || 0) + count;
    }
    for (const [date, data] of Object.entries(processed.dailyData)) {
      const dailyStat = (dailyData[date] ||= { watchTime: 0, plays: 0 });
      dailyStat.watchTime += data.watchTime;
      dailyStat.plays += data.plays;
    }
  }

  userStats.sort(
    (left, right) => (right.totalWatchTime || 0) - (left.totalWatchTime || 0),
  );

  const topSources = Object.entries(sourceCount)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 5)
    .map(([source, count]) => ({ source, count }));

  const dailyStats: PlayStatsResult['dailyStats'] = [];
  const registrationTrend: PlayStatsResult['registrationStats']['registrationTrend'] =
    [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const currentDate = dateKey(nowTimestamp - daysAgo * DAY_MS);
    const dailyStat = dailyData[currentDate] || { watchTime: 0, plays: 0 };
    dailyStats.push({ date: currentDate, ...dailyStat });
    registrationTrend.push({
      date: currentDate,
      newUsers: registrationData[currentDate] || 0,
    });
  }

  const oneDayAgo = nowTimestamp - DAY_MS;
  const thirtyDaysAgo = nowTimestamp - 30 * DAY_MS;
  const activeUsers = userStats.reduce(
    (counts, user) => {
      const lastLoginTime = user.lastLoginTime || 0;
      if (lastLoginTime >= oneDayAgo) counts.daily++;
      if (lastLoginTime >= sevenDaysAgoTime) counts.weekly++;
      if (lastLoginTime >= thirtyDaysAgo) counts.monthly++;
      return counts;
    },
    { daily: 0, weekly: 0, monthly: 0 },
  );

  return {
    totalUsers: users.length,
    totalWatchTime,
    totalMovies,
    totalPlays,
    avgWatchTimePerUser: users.length > 0 ? totalWatchTime / users.length : 0,
    avgPlaysPerUser: users.length > 0 ? totalPlays / users.length : 0,
    userStats,
    topSources,
    dailyStats,
    registrationStats: {
      todayNewUsers,
      totalRegisteredUsers: users.length,
      registrationTrend,
    },
    activeUsers,
  };
}
