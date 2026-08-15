/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { calculateRegistrationDays } from '@/lib/play-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await loadConfig();
    const username = process.env.USERNAME;

    // 检查用户权限（管理员或普通用户）
    if (authInfo.username !== username) {
      // 非站长，检查用户存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }
    // 获取用户个人统计数据
    const userStats = await db.getUserStat(authInfo.username);
    // 对于所有用户（包括站长），都尝试从配置中获取创建时间
    const user = config.UserConfig.Users.find(
      (u) => u.username === authInfo.username,
    );
    // 使用与管理员统计相同的逻辑
    let userCreatedAt = user?.createdAt || Date.now();
    // 增强统计数据：添加注册天数和登录天数计算
    const registrationDays = calculateRegistrationDays(userCreatedAt);
    userStats.registrationDays = registrationDays;
    userStats.createdAt = userCreatedAt;
    return NextResponse.json(userStats, { status: 200 });
  } catch (err) {
    console.error('获取用户个人统计失败:', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

// PUT 方法：记录用户登入时间
export async function PUT(request: NextRequest) {
  try {
    console.log('PUT /api/user/my-stats - 记录用户登入时间');

    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await loadConfig();
    const username = process.env.USERNAME;

    // 检查用户权限
    if (authInfo.username !== username) {
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }
    // 保存登入统计到数据库
    try {
      await db.updateUserStats(authInfo.username);
    } catch (saveError) {
      console.error('保存登入统计失败:', saveError);
      // 即使保存失败也返回成功，因为登录本身是成功的
    }
    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    console.error('PUT /api/user/my-stats - 记录登入时间失败:', error);
  }
}
