/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { EpisodeSkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: '未登录' }, { status: 401 });
    }

    const config = await loadConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        return json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      // 获取单个配置
      const config = await db.getEpisodeSkipConfig(
        authInfo.username,
        source,
        id,
      );
      return json(config);
    } else {
      // 获取所有配置
      const configs = await db.getAllEpisodeSkipConfigs(authInfo.username);
      return json(configs);
    }
  } catch (error) {
    console.error('获取剧集跳过配置失败:', error);
    return json({ error: '获取剧集跳过配置失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: '未登录' }, { status: 401 });
    }

    const adminConfig = await loadConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        return json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { source, id, config } = body;

    if (!source || !id || !config) {
      return json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证配置格式
    const episodeSkipConfig: EpisodeSkipConfig = {
      source: String(config.source),
      id: String(config.id),
      title: String(config.title),
      segments: Array.isArray(config.segments) ? config.segments : [],
      updated_time: Number(config.updated_time) || Date.now(),
    };

    await db.saveEpisodeSkipConfig(
      authInfo.username,
      source,
      id,
      episodeSkipConfig,
    );

    return json({ success: true });
  } catch (error) {
    console.error('保存剧集跳过配置失败:', error);
    return json({ error: '保存剧集跳过配置失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: '未登录' }, { status: 401 });
    }

    const adminConfig = await loadConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        return json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (!source || !id) {
      return json({ error: '缺少必要参数' }, { status: 400 });
    }

    await db.deleteEpisodeSkipConfig(authInfo.username, source, id);

    return json({ success: true });
  } catch (error) {
    console.error('删除剧集跳过配置失败:', error);
    return json({ error: '删除剧集跳过配置失败' }, { status: 500 });
  }
}
