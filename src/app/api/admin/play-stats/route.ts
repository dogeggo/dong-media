import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { PlayStatsResult, UserStat } from '@/lib/types';

import { calculateRegistrationDays } from '@/app/api/user/my-stats/route';

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
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await loadConfig();
    const username = authInfo.username;

    // 判定操作者角色
    let _operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      _operatorRole = 'owner';
    } else {
      const userEntry = config.UserConfig.Users.find(
        (u) => u.username === username,
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      _operatorRole = 'admin';
    }

    // 使用LunaTV-stat相同的方式：直接在API路由中实现统计逻辑，从config获取用户列表
    const allUsers = config.UserConfig.Users;
    const userStats: Array<UserStat> = [];
    let totalWatchTime = 0;
    let totalPlays = 0;
    const sourceCount: Record<string, number> = {};
    const dailyData: Record<string, { watchTime: number; plays: number }> = {};

    // 用户注册统计
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    let todayNewUsers = 0;
    let totalRegisteredUsers = 0;
    let totalMovies = 0;
    const registrationData: Record<string, number> = {};

    // 计算近7天的日期范围
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 为每个用户获取播放记录统计
    for (const user of allUsers) {
      try {
        // 计算用户注册相关统计
        // 设置项目开始时间，2025年9月14日
        const userCreatedAt = user.createdAt || Date.now();
        const registrationDays = calculateRegistrationDays(userCreatedAt);
        // 统计今日新增用户
        if (userCreatedAt >= todayStart) {
          todayNewUsers++;
        }
        totalRegisteredUsers++;
        // 统计注册时间分布（近7天）
        if (userCreatedAt >= sevenDaysAgo.getTime()) {
          const regDate = new Date(userCreatedAt).toISOString().split('T')[0];
          registrationData[regDate] = (registrationData[regDate] || 0) + 1;
        }
        // 获取用户最后登录时间和登入次数（从用户统计中获取真实登入时间）
        const dbUserStat = await db.getUserStat(user.username);
        const playRecords = await db.getAllPlayRecords(user.username);
        const records = Object.values(playRecords);
        records.forEach((record) => {
          // 统计近7天数据
          const recordDate = new Date(record.save_time);
          if (recordDate >= sevenDaysAgo) {
            const dateKey = recordDate.toISOString().split('T')[0];
            if (!dailyData[dateKey]) {
              dailyData[dateKey] = { watchTime: 0, plays: 0 };
            }
            dailyData[dateKey].watchTime += record.play_time || 0;
            dailyData[dateKey].plays += 1;
          }
          const sourceName = record.source_name || '未知来源';
          sourceCount[sourceName] = (sourceCount[sourceName] || 0) + 1;
        });
        dbUserStat.registrationDays = registrationDays;
        dbUserStat.createdAt = userCreatedAt;
        userStats.push(dbUserStat);
        // 累计全站统计
        totalWatchTime += dbUserStat.totalWatchTime || 0;
        totalPlays += dbUserStat.totalPlays || 0;
        totalMovies += dbUserStat.totalMovies || 0;
      } catch (_error) {
        console.log('获取用户统计数据错误.', _error);
      }
    }
    // 按最近登录时间降序排序
    userStats.sort((a, b) => b.totalWatchTime - a.totalWatchTime);

    // 整理热门来源数据（取前5个）
    const topSources = Object.entries(sourceCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));

    // 整理近7天数据
    const dailyStats: Array<{
      date: string;
      watchTime: number;
      plays: number;
    }> = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const data = dailyData[dateKey] || { watchTime: 0, plays: 0 };
      dailyStats.push({
        date: dateKey,
        watchTime: data.watchTime,
        plays: data.plays,
      });
    }

    // 整理近7天注册数据
    const registrationStats: Array<{ date: string; newUsers: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const newUsers = registrationData[dateKey] || 0;
      registrationStats.push({
        date: dateKey,
        newUsers,
      });
    }

    // 计算活跃用户统计
    const oneDayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    const sevenDaysAgoTime = sevenDaysAgo.getTime();
    const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

    const activeUsers = {
      daily: userStats.filter((user) => user.lastLoginTime >= oneDayAgo).length,
      weekly: userStats.filter((user) => user.lastLoginTime >= sevenDaysAgoTime)
        .length,
      monthly: userStats.filter((user) => user.lastLoginTime >= thirtyDaysAgo)
        .length,
    };

    const result: PlayStatsResult = {
      totalUsers: allUsers.length,
      totalWatchTime,
      totalMovies,
      totalPlays,
      avgWatchTimePerUser:
        allUsers.length > 0 ? totalWatchTime / allUsers.length : 0,
      avgPlaysPerUser: allUsers.length > 0 ? totalPlays / allUsers.length : 0,
      userStats,
      topSources,
      dailyStats,
      // 新增的注册和活跃度统计
      registrationStats: {
        todayNewUsers,
        totalRegisteredUsers,
        registrationTrend: registrationStats,
      },
      activeUsers,
    };

    return NextResponse.json(result, {
      headers: noStoreResponseHeaders(),
    });
  } catch (error) {
    // console.error('获取播放统计失败:', error);
    return NextResponse.json(
      {
        error: '获取播放统计失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
