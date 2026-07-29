import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { generateTVBoxToken } from '@/lib/tvbox-token';

export const runtime = 'nodejs';

// POST - 为用户生成或重新生成 TVBox Token
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { username, regenerateToken } = body;

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 },
      );
    }

    // 获取当前配置
    const config = await loadConfig();

    // 检查权限：只有 owner 和 admin 可以管理用户 Token
    const currentUser = config.UserConfig.Users.find(
      (u) => u.username === authInfo.username,
    );
    if (
      !currentUser ||
      (currentUser.role !== 'owner' && currentUser.role !== 'admin')
    ) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // 查找目标用户
    const targetUser = config.UserConfig.Users.find(
      (u) => u.username === username,
    );
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // admin 不能修改 owner 和其他 admin 的配置
    if (
      currentUser.role === 'admin' &&
      (targetUser.role === 'owner' || targetUser.role === 'admin')
    ) {
      return NextResponse.json(
        { error: 'Cannot modify admin or owner users' },
        { status: 403 },
      );
    }

    // 生成或保留 Token
    if (regenerateToken || !targetUser.tvboxToken) {
      targetUser.tvboxToken = generateTVBoxToken();
    }

    // 保存配置
    await db.saveAdminConfig(config);

    return NextResponse.json({
      success: true,
      token: targetUser.tvboxToken,
    });
  } catch (error) {
    console.error('Update user TVBox token failed:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
