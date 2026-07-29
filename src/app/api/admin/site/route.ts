/* eslint-disable no-console */

import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      ShowAdultContent,
      FluidSearch,
      TMDBApiKey,
      TMDBLanguage,
      EnableTMDBActorSearch,
    } = body as {
      SiteName: string;
      Announcement: string;
      SearchDownstreamMaxPage: number;
      ShowAdultContent: boolean;
      FluidSearch: boolean;
      TMDBApiKey?: string;
      TMDBLanguage?: string;
      EnableTMDBActorSearch?: boolean;
    };

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof FluidSearch !== 'boolean'
    ) {
      return json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await loadConfig();

    // 权限校验
    if (username !== process.env.USERNAME) {
      // 管理员
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 更新缓存中的站点设置，保留现有的自定义去广告配置
    adminConfig.SiteConfig = {
      ...adminConfig.SiteConfig, // 保留所有现有字段
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      ShowAdultContent,
      FluidSearch,
      TMDBApiKey: TMDBApiKey || '',
      TMDBLanguage: TMDBLanguage || 'zh-CN',
      EnableTMDBActorSearch: EnableTMDBActorSearch || false,
    };

    // 写入数据库
    await db.saveAdminConfig(adminConfig);

    // 🔥 刷新所有页面的缓存，使新配置立即生效（无需重启Docker）
    revalidatePath('/', 'layout');

    return json({ ok: true, shouldReload: true });
  } catch (error) {
    console.error('更新站点配置失败:', error);
    return json(
      {
        error: '更新站点配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
