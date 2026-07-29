/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { PlayRecord } from '@/lib/types';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

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

    const records = await db.getAllPlayRecords(authInfo.username);
    return json(records, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return json({ error: 'Missing key or record' }, { status: 400 });
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      return json({ error: 'Invalid record data' }, { status: 400 });
    }

    // 从key中解析source和id
    const [source, id] = key.split('+');
    if (!source || !id) {
      return json({ error: 'Invalid key format' }, { status: 400 });
    }

    // 获取现有播放记录以保持原始集数
    const existingRecord = await db.getPlayRecord(authInfo.username, key);

    // 🔑 关键修复：信任客户端传来的 original_episodes（已经过 checkShouldUpdateOriginalEpisodes 验证）
    // 只有在客户端没有提供时，才使用数据库中的值作为 fallback
    let originalEpisodes: number;
    if (
      record.original_episodes !== undefined &&
      record.original_episodes !== null
    ) {
      // 客户端已经设置了 original_episodes，信任它（可能是更新后的值）
      originalEpisodes = record.original_episodes;
    } else {
      // 客户端没有提供，使用数据库中的值或当前 total_episodes
      originalEpisodes =
        existingRecord?.original_episodes ||
        existingRecord?.total_episodes ||
        record.total_episodes;
    }
    record.key = key;
    const finalRecord = {
      ...record,
      save_time: record.save_time ?? Date.now(),
      last_tj_time: existingRecord?.last_tj_time ?? Date.now(),
      original_episodes: originalEpisodes,
    } as PlayRecord;
    const userMovieHis = `user_movie_his:${authInfo.username}`;
    const timeCon =
      finalRecord.play_time > 0 &&
      finalRecord.total_time > 0 &&
      finalRecord.play_time >= finalRecord.total_time * 0.8;
    if (
      (timeCon && finalRecord.total_episodes == 1) ||
      (timeCon &&
        finalRecord.total_episodes > 1 &&
        finalRecord.index >= finalRecord.total_episodes * 0.9)
    ) {
      const movieKey = `${record.title}_${record.year}`;
      await db.getClient().sAdd(userMovieHis, movieKey);
    }
    await db.updateUserStats(authInfo.username, finalRecord);
    await db.savePlayRecord(authInfo.username, key, finalRecord);
    return json({ success: true, record: finalRecord }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
    let deletedRecord: PlayRecord | null = null;

    if (key) {
      // 如果提供了 key，删除单条播放记录
      const [source, id] = key.split('+');
      if (!source || !id) {
        return json({ error: 'Invalid key format' }, { status: 400 });
      }

      deletedRecord = await db.getPlayRecord(username, key);
      await db.deletePlayRecord(username, source, id);
    } else {
      // 未提供 key，则清空全部播放记录
      // 目前 DbManager 没有对应方法，这里直接遍历删除
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deletePlayRecord(username, s, i);
        }),
      );
    }

    return json({ success: true, record: deletedRecord }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
