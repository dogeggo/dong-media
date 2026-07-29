import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getAvailableApiSites, loadConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染

// 返回当前登录用户的专属 TVBox 配置，不暴露完整管理配置。
export async function GET(request: NextRequest) {
  try {
    // 检查用户是否登录
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: noStoreResponseHeaders() },
      );
    }

    // 获取配置
    const config = await loadConfig();

    // 🔑 获取当前用户的专属配置
    const currentUser = config.UserConfig.Users.find(
      (u) => u.username === authInfo.username,
    );
    const userTvboxToken = currentUser?.tvboxToken || '';

    // 与站内账号使用同一套权限计算结果。
    const allSources = (await getAvailableApiSites(authInfo.username)).map(
      (source) => ({ key: source.key, name: source.name }),
    );

    // 只返回当前用户生成配置链接所需的信息。
    return NextResponse.json(
      {
        siteName: config.SiteConfig?.SiteName || 'Dong Media',
        // 🔑 新增：用户专属信息
        userToken: userTvboxToken,
        allSources: allSources,
      },
      { headers: noStoreResponseHeaders() },
    );
  } catch (error) {
    console.error('获取 TVBox 配置失败:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
