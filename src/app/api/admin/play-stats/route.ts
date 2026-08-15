import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  CACHE_POLICIES,
  cacheService,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { buildPlayStats } from '@/lib/play-stats';

// 导出类型供页面组件使用
export type { PlayStatsResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行播放统计查看',
      },
      { status: 400 },
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await loadConfig();
    const username = authInfo.username;

    if (username !== process.env.USERNAME) {
      const userEntry = config.UserConfig.Users.find(
        (user) => user.username === username,
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const allUsers = config.UserConfig.Users;
    const startedAt = performance.now();
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const statsResult = await cacheService.getOrLoadResult(
      CACHE_POLICIES.PLAY_STATS,
      {
        users: allUsers.map((user) => [user.username, user.createdAt || 0]),
      },
      () =>
        buildPlayStats(
          allUsers,
          (userName) => db.getUserStatsSnapshot(userName),
          {
            onUserError: (userName, error) => {
              console.error(`获取用户 ${userName} 统计数据错误:`, error);
            },
          },
        ),
      { forceRefresh },
    );

    return NextResponse.json(statsResult.value, {
      headers: noStoreResponseHeaders({
        'Server-Timing': `play-stats;dur=${(
          performance.now() - startedAt
        ).toFixed(1)}`,
        'X-Play-Stats-Cache': statsResult.status,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取播放统计失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
