import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import type { EpisodeSkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

async function authenticatedUsername(
  request: NextRequest,
): Promise<string | Response> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return json({ error: '用户未登录' }, { status: 401 });
  }
  if (authInfo.username === process.env.USERNAME) return authInfo.username;

  const config = await loadConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === authInfo.username,
  );
  if (!user || user.banned) {
    return json(
      { error: user?.banned ? '用户已被封禁' : '用户不存在' },
      { status: 401 },
    );
  }
  return authInfo.username;
}

export async function POST(request: NextRequest) {
  try {
    const username = await authenticatedUsername(request);
    if (username instanceof Response) return username;

    const body = (await request.json()) as {
      action?: string;
      key?: string;
      config?: EpisodeSkipConfig;
    };
    const { action, key, config } = body;
    if (!action) return json({ error: '缺少操作类型' }, { status: 400 });

    if (action === 'getAll') {
      return json({ configs: await db.getAllSkipConfigs(username) });
    }

    if (!key) return json({ error: '缺少配置键' }, { status: 400 });
    const [source, id] = key.split('+');
    if (!source || !id) {
      return json({ error: '无效的key格式' }, { status: 400 });
    }

    switch (action) {
      case 'get':
        return json({ config: await db.getSkipConfig(username, source, id) });
      case 'set': {
        if (!isValidConfig(config)) {
          return json({ error: '配置数据格式错误' }, { status: 400 });
        }
        await db.setSkipConfig(username, source, id, config);
        return json({
          success: true,
          configs: await db.getAllSkipConfigs(username),
        });
      }
      case 'delete':
        await db.deleteSkipConfig(username, source, id);
        return json({
          success: true,
          configs: await db.getAllSkipConfigs(username),
        });
      default:
        return json({ error: '不支持的操作类型' }, { status: 400 });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('跳过配置 API 错误:', error);
    return json({ error: '服务器内部错误' }, { status: 500 });
  }
}

function isValidConfig(
  config: EpisodeSkipConfig | undefined,
): config is EpisodeSkipConfig {
  if (
    !config?.source ||
    !config.id ||
    !config.title ||
    !Array.isArray(config.segments)
  ) {
    return false;
  }
  return config.segments.every(
    (segment) =>
      typeof segment.start === 'number' &&
      typeof segment.end === 'number' &&
      segment.start < segment.end &&
      (segment.type === 'opening' || segment.type === 'ending'),
  );
}
