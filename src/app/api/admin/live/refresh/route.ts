/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { refreshLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 权限检查
    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    const config = await loadConfig();
    if (username !== process.env.USERNAME) {
      // 管理员
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json(
          { error: '权限不足' },
          { status: 401, headers: noStoreResponseHeaders() },
        );
      }
    }

    // 并发刷新所有启用的直播源
    const failedSources: string[] = [];
    const refreshPromises = (config.LiveConfig || [])
      .filter((liveInfo) => !liveInfo.disabled)
      .map(async (liveInfo) => {
        try {
          const channels = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = channels?.channelNumber || 0;
        } catch (_error) {
          failedSources.push(liveInfo.key);
        }
      });

    // 等待所有刷新任务完成
    await Promise.all(refreshPromises);

    // 这里只更新统计性的频道数；刷新结果已经写入统一 live cache，
    // 不应再次切换 generation 使刚完成的刷新立即失效。
    await db.saveAdminConfig(config, { invalidateCache: false });

    if (failedSources.length) {
      return NextResponse.json(
        {
          success: false,
          message: '部分直播源刷新失败，已有旧缓存仍被保留',
          failedSources,
        },
        { status: 502, headers: noStoreResponseHeaders() },
      );
    }

    return NextResponse.json(
      { success: true, message: '直播源刷新成功' },
      { headers: noStoreResponseHeaders() },
    );
  } catch (error) {
    console.error('直播源刷新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
