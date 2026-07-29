/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { Favorite } from '@/lib/types';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

/**
 * GET /api/favorites
 *
 * 支持两种调用方式：
 * 1. 不带 query，返回全部收藏列表（Record<string, Favorite>）。
 * 2. 带 key=source+id，返回单条收藏（Favorite | null）。
 */
export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: 'Unauthorized' }, { status: 401 });
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
    const key = searchParams.get('key');

    // 查询单条收藏
    if (key) {
      const [source, id] = key.split('+');
      if (!source || !id) {
        return json({ error: 'Invalid key format' }, { status: 400 });
      }
      const fav = await db.getFavorite(authInfo.username, source, id);
      return json(fav, { status: 200 });
    }

    // 查询全部收藏 - 开始性能监控
    const startTime = Date.now();
    const favorites = await db.getAllFavorites(authInfo.username);
    const duration = Date.now() - startTime;
    const count = Object.keys(favorites).length;

    // 性能监控日志
    const durationSeconds = (duration / 1000).toFixed(2);

    // 性能警告 - 根据不同耗时输出不同级别的日志
    if (duration > 25000) {
      console.error(
        `❌ [严重慢查询] 用户 ${authInfo.username} 的收藏查询耗时 ${durationSeconds}s，接近超时阈值！收藏数: ${count}`,
      );
    } else if (duration > 15000) {
      console.warn(
        `⚠️  [慢查询警告] 用户 ${authInfo.username} 的收藏查询耗时 ${durationSeconds}s，建议优化。收藏数: ${count}`,
      );
    } else if (duration > 5000) {
      console.log(
        `⏱️  [性能提示] 用户 ${authInfo.username} 的收藏查询耗时 ${durationSeconds}s，性能尚可。收藏数: ${count}`,
      );
    }
    return json(favorites, { status: 200 });
  } catch (err) {
    console.error('获取收藏失败', err);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/favorites
 * body: { key: string; favorite: Favorite }
 */
export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: 'Unauthorized' }, { status: 401 });
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

    const body = await request.json();
    const { key, favorite }: { key: string; favorite: Favorite } = body;

    if (!key || !favorite) {
      return json({ error: 'Missing key or favorite' }, { status: 400 });
    }

    // 验证必要字段
    if (!favorite.title || !favorite.source_name) {
      return json({ error: 'Invalid favorite data' }, { status: 400 });
    }

    const [source, id] = key.split('+');
    if (!source || !id) {
      return json({ error: 'Invalid key format' }, { status: 400 });
    }

    const finalFavorite = {
      ...favorite,
      save_time: favorite.save_time ?? Date.now(),
    } as Favorite;

    await db.saveFavorite(authInfo.username, source, id, finalFavorite);

    const favorites = await db.getAllFavorites(authInfo.username);
    return json({ success: true, favorites }, { status: 200 });
  } catch (err) {
    console.error('保存收藏失败', err);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/favorites
 *
 * 1. 不带 query -> 清空全部收藏
 * 2. 带 key=source+id -> 删除单条收藏
 */
export async function DELETE(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return json({ error: 'Unauthorized' }, { status: 401 });
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

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 删除单条
      const [source, id] = key.split('+');
      if (!source || !id) {
        return json({ error: 'Invalid key format' }, { status: 400 });
      }
      await db.deleteFavorite(username, source, id);
    } else {
      // 清空全部
      const startTime = Date.now();
      const all = await db.getAllFavorites(username);
      const duration = Date.now() - startTime;
      const count = Object.keys(all).length;

      console.log(
        `[收藏性能-删除] 用户: ${username} | 待删除收藏数: ${count} | 查询耗时: ${(duration / 1000).toFixed(2)}s`,
      );

      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deleteFavorite(username, s, i);
        }),
      );
    }

    const favorites = await db.getAllFavorites(username);
    return json({ success: true, favorites }, { status: 200 });
  } catch (err) {
    console.error('删除收藏失败', err);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
