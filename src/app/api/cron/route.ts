/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getAvailableApiSites, loadConfig, refineConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import {
  isInactiveUserExemptFromCleanup,
  normalizeInactiveUserCleanupExemptWatchHours,
} from '@/lib/inactive-user-cleanup';
import { refreshLiveChannels } from '@/lib/live';
import { warmReleaseCalendarCache } from '@/lib/release-calendar-cache';
import { SearchResult, UserStat } from '@/lib/types';
import { generateSearchVariants } from '@/lib/utils';

export const runtime = 'nodejs';

// 添加全局锁避免并发执行
let isRunning = false;

export async function GET(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  console.log(hostname);
  if (
    hostname !== '127.0.0.1' &&
    hostname !== 'localhost' &&
    hostname !== '0.0.0.0'
  ) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: noStoreResponseHeaders(),
    });
  }

  if (isRunning) {
    console.log('⚠️ Cron job 已在运行中，跳过此次请求');
    return NextResponse.json(
      {
        success: false,
        message: 'Cron job already running',
        timestamp: new Date().toISOString(),
      },
      { headers: noStoreResponseHeaders() },
    );
  }

  try {
    isRunning = true;
    console.log('Cron job triggered:', new Date().toISOString());

    await cronJob();

    return NextResponse.json(
      {
        success: true,
        message: 'Cron job executed successfully',
        timestamp: new Date().toISOString(),
      },
      { headers: noStoreResponseHeaders() },
    );
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  } finally {
    isRunning = false;
  }
}

async function cronJob() {
  console.log('🚀 开始执行定时任务...');

  // 优先执行用户清理任务，避免被其他任务阻塞
  try {
    console.log('🧹 执行用户清理任务...');
    await cleanupInactiveUsers();
    console.log('✅ 用户清理任务完成');
  } catch (err) {
    console.error('❌ 用户清理任务失败:', err);
  }

  try {
    console.log('📝 刷新配置...');
    await refreshConfig();
    console.log('✅ 配置刷新完成');
  } catch (err) {
    console.error('❌ 配置刷新失败:', err);
  }

  try {
    console.log('📺 刷新直播频道...');
    await refreshAllLiveChannels();
    console.log('✅ 直播频道刷新完成');
  } catch (err) {
    console.error('❌ 直播频道刷新失败:', err);
  }

  try {
    console.log('📅 预热发布日历...');
    const calendarCache = await warmReleaseCalendarCache();
    if (calendarCache.status === 'STALE') {
      console.warn(
        `⚠️ 发布日历刷新失败，已保留上一份完整缓存: ${calendarCache.value.items.length} 条`,
      );
    } else {
      console.log(
        `✅ 发布日历预热完成 (${calendarCache.status}): ${calendarCache.value.items.length} 条`,
      );
    }
  } catch (err) {
    console.error('❌ 发布日历预热失败:', err);
  }

  // try {
  //   console.log('📊 刷新播放记录和收藏...');
  //   await refreshRecordAndFavorites();
  //   console.log('✅ 播放记录和收藏刷新完成');
  // } catch (err) {
  //   console.error('❌ 播放记录和收藏刷新失败:', err);
  // }

  console.log('🎉 定时任务执行完成');
}

async function refreshAllLiveChannels() {
  const config = await loadConfig();

  // 并发刷新所有启用的直播源
  const refreshPromises = (config.LiveConfig || [])
    .filter((liveInfo) => !liveInfo.disabled)
    .map(async (liveInfo) => {
      try {
        const channels = await refreshLiveChannels(liveInfo);
        liveInfo.channelNumber = channels?.channelNumber || 0;
      } catch (error) {
        console.error(
          `刷新直播源失败 [${liveInfo.name || liveInfo.key}]:`,
          error,
        );
      }
    });

  // 等待所有刷新任务完成
  await Promise.all(refreshPromises);

  // 这里只持久化频道数量。刷新结果已经写入当前 live generation，
  // 再次全局失效会让刚完成的刷新立即丢失。
  await db.saveAdminConfig(config, { invalidateCache: false });
}

async function refreshConfig() {
  let config = await loadConfig();
  if (
    config &&
    config.ConfigSubscribtion &&
    config.ConfigSubscribtion.URL &&
    config.ConfigSubscribtion.AutoUpdate
  ) {
    try {
      console.log('🌐 开始获取配置订阅:', config.ConfigSubscribtion.URL);

      // 设置30秒超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(config.ConfigSubscribtion.URL, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LunaTV-ConfigFetcher/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const configContent = await response.text();

      // 对 configContent 进行 base58 解码
      let decodedContent;
      try {
        const bs58 = (await import('bs58')).default;
        const decodedBytes = bs58.decode(configContent);
        decodedContent = new TextDecoder().decode(decodedBytes);
      } catch (decodeError) {
        console.warn('Base58 解码失败:', decodeError);
        throw decodeError;
      }

      try {
        JSON.parse(decodedContent);
      } catch (_e) {
        throw new Error('配置文件格式错误，请检查 JSON 语法');
      }
      config.ConfigFile = decodedContent;
      config.ConfigSubscribtion.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await db.saveAdminConfig(config);
    } catch (e) {
      console.error('刷新配置失败:', e);
    }
  } else {
    console.log('跳过刷新：未配置订阅地址或自动更新');
  }
}

async function refreshRecordAndFavorites() {
  try {
    const config = await loadConfig();

    const userNameSet = new Set(config.UserConfig.Users.map((u) => u.username));

    if (process.env.USERNAME) {
      userNameSet.add(process.env.USERNAME);
    }
    const userNames = Array.from(userNameSet);
    console.log('📋 最终处理用户列表:', userNames);
    // 函数级缓存：key 为 `${source}+${id}`，值为 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();
    // 获取详情 Promise（带缓存和错误处理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string,
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        }).catch((err) => {
          detailCache.delete(key);
          return null;
        });
        // 先缓存 Promise，避免并发重复请求
        detailCache.set(key, promise);
      }
      return promise;
    };
    console.error(`开始处理播放记录/收藏任务...`);

    const processUser = async (userName: string) => {
      // 播放记录
      try {
        const playRecords = await db.getAllPlayRecords(userName);
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              continue;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await db.savePlayRecord(userName, key, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
                // 🔑 关键修复：保留原始集数，避免被Cron任务覆盖
                original_episodes: record.original_episodes,
              });
            }
            processedRecords++;
          } catch (err) {
            console.error(`处理播放记录失败(${userName}) (${key}):`, err);
          }
        }
        console.log(
          `播放记录处理完成(${userName}), sum = ${Object.keys(playRecords).length}, success = ${processedRecords}`,
        );
      } catch (err) {
        console.error(`获取用户播放记录失败 (${userName}):`, err);
      }
      // 收藏
      try {
        let favorites = await db.getAllFavorites(userName);
        favorites = Object.fromEntries(
          Object.entries(favorites).filter(([_, fav]) => fav.origin !== 'live'),
        );
        let processedFavorites = 0;

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              continue;
            }
            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              continue;
            }
            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(userName, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
            }

            processedFavorites++;
          } catch (err) {
            console.error(`处理收藏失败 (${key}):`, err);
          }
        }
        console.log(
          `收藏处理完成(${userName}), sum = ${Object.keys(favorites).length}, success = ${processedFavorites}`,
        );
      } catch (err) {
        console.error(`获取用户收藏失败 (${userName}):`, err);
      }
    };

    const rawConcurrency = Number(process.env.CRON_USER_CONCURRENCY || 3);
    const concurrency = Number.isFinite(rawConcurrency)
      ? Math.max(1, Math.min(userNames.length, rawConcurrency))
      : Math.min(userNames.length, 3);
    console.log(`⚙️ 并发处理用户数: ${concurrency}`);

    const userQueue = [...userNames];
    const workers = Array.from({ length: concurrency }, async () => {
      while (userQueue.length > 0) {
        const nextUser = userQueue.shift();
        if (!nextUser) {
          return;
        }
        await processUser(nextUser);
      }
    });
    await Promise.all(workers);

    console.log('刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('刷新播放记录/收藏任务启动失败', err);
  }
}

async function cleanupInactiveUsers() {
  try {
    const config = await loadConfig();

    // 清理策略：先根据登入/注册时间识别非活跃用户，再根据累计播放时长豁免。
    // 删除条件：最后活动时间早于阈值，且累计播放时长未超过保护阈值。

    // 检查是否启用自动清理功能
    const autoCleanupEnabled =
      config.UserConfig?.AutoCleanupInactiveUsers ?? false;
    const inactiveUserDays = config.UserConfig?.InactiveUserDays ?? 7;
    const cleanupExemptWatchHours =
      normalizeInactiveUserCleanupExemptWatchHours(
        config.UserConfig?.InactiveUserCleanupExemptWatchHours,
      );

    console.log(
      `📋 清理配置: 启用=${autoCleanupEnabled}, 保留天数=${inactiveUserDays}, 播放时长保护阈值=${cleanupExemptWatchHours}小时`,
    );

    if (!autoCleanupEnabled) {
      return;
    }

    console.log('🧹 开始清理非活跃用户...');

    const allUsers = config.UserConfig.Users;

    const envUsername = process.env.USERNAME;

    const cutoffTime = Date.now() - inactiveUserDays * 24 * 60 * 60 * 1000;

    let deletedCount = 0;

    for (const user of allUsers) {
      try {
        // 跳过管理员和owner用户
        if (user.role === 'admin' || user.role === 'owner') {
          continue;
        }
        // 跳过环境变量中的用户
        if (user.username === envUsername) {
          continue;
        }
        // 获取用户统计信息（5秒超时）
        let userStats;
        try {
          userStats = await Promise.race<UserStat>([
            db.getUserStat(user.username),
            new Promise<UserStat>((_, reject) =>
              setTimeout(() => reject(new Error('getUserPlayStat超时')), 5000),
            ),
          ]);
        } catch (err) {
          console.error(`  ❌ 获取用户统计失败: ${err}, 跳过该用户`);
          continue;
        }
        // 清理口径：优先使用最后登入时间；如果用户从未登入，则退回到注册时间。
        // 这样可以清理长期未激活的账号，避免“待激活/尚未登录”的残留用户长期保留。
        const lastLoginTime = userStats.lastLoginTime || 0;
        const createdAt = user.createdAt || 0;
        const lastActiveTime = lastLoginTime > 0 ? lastLoginTime : createdAt;
        const activityType = lastLoginTime > 0 ? '最后登入' : '注册时间';

        // 删除条件：最后活动时间早于阈值。
        // 对从未登入的用户，最后活动时间即注册时间。
        const shouldDelete = lastActiveTime > 0 && lastActiveTime < cutoffTime;

        if (shouldDelete) {
          const totalWatchTime = userStats.totalWatchTime || 0;
          if (
            isInactiveUserExemptFromCleanup(
              totalWatchTime,
              cleanupExemptWatchHours,
            )
          ) {
            console.log(
              `🛡️ 保留非活跃用户: ${user.username} (累计播放时长: ${(totalWatchTime / 60 / 60).toFixed(2)}小时，大于保护阈值: ${cleanupExemptWatchHours}小时)`,
            );
            continue;
          }

          console.log(
            `🗑️ 删除非活跃用户: ${user.username} (${activityType}: ${new Date(lastActiveTime).toISOString()}, 登入次数: ${userStats.loginCount || 0}, 累计播放时长: ${(totalWatchTime / 60 / 60).toFixed(2)}小时, 阈值: ${inactiveUserDays}天)`,
          );

          // 从数据库删除用户数据
          await db.deleteUser(user.username);

          // 从配置中移除用户
          const userIndex = config.UserConfig.Users.findIndex(
            (u) => u.username === user.username,
          );
          if (userIndex !== -1) {
            config.UserConfig.Users.splice(userIndex, 1);
          }
          deletedCount++;
        }
      } catch (err) {
        console.error(`❌ 处理用户 ${user.username} 时出错:`, err);
      }
    }

    // 如果有删除操作，保存更新后的配置
    if (deletedCount > 0) {
      await db.saveAdminConfig(config);
      console.log(`✨ 清理完成，共删除 ${deletedCount} 个非活跃用户`);
    }
  } catch (err) {
    console.error('🚫 清理非活跃用户任务失败:', err);
  }
}

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
}

/**
 * 根据 source 与 id 获取视频详情。
 * 1. 若传入 fallbackTitle，则先调用 /api/search 搜索精确匹配。
 * 2. 若搜索未命中或未提供 fallbackTitle，则直接调用 /api/detail。
 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
}: FetchVideoDetailOptions): Promise<SearchResult> {
  // 优先通过搜索接口查找精确匹配
  const apiSites = await getAvailableApiSites();
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('无效的API来源');
  }
  if (fallbackTitle) {
    try {
      const config = await loadConfig();
      const searchVariants = generateSearchVariants(fallbackTitle.trim());
      const maxPage: number = config.SiteConfig.SearchDownstreamMaxPage;
      const searchData = await searchFromApi(apiSite, searchVariants, maxPage);
      const exactMatch = searchData.find(
        (item: SearchResult) =>
          item.source.toString() === source.toString() &&
          item.id.toString() === id.toString(),
      );
      if (exactMatch) {
        return exactMatch;
      }
    } catch (_error) {
      // do nothing
    }
  }

  // 调用 /api/detail 接口
  const detail = await getDetailFromApi(apiSite, id);
  if (!detail) {
    throw new Error('获取视频详情失败');
  }

  return detail;
}
