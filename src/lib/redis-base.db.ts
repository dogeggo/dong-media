/* eslint-disable no-console */

import { createClient, RedisClientType } from 'redis';

import { db } from '@/lib/db';

import { AdminConfig } from './admin.types';
import { assertNamespacedOidcSub } from './oidc-sub';
import {
  EpisodeSkipConfig,
  Favorite,
  IStorage,
  PlayRecord,
  UserStat,
  UserStatsSnapshot,
} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

function parseStoredJson<T>(value: unknown): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }

  return value as T;
}

// 连接配置接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用于日志显示，如 "Redis" 或 "Pika"
}

// 添加Redis操作重试包装器
function createRetryWrapper(
  clientName: string,
  getClient: () => RedisClientType,
) {
  return async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (err: any) {
        const isLastAttempt = i === maxRetries - 1;
        const isConnectionError =
          err.message?.includes('Connection') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ENOTFOUND') ||
          err.code === 'ECONNRESET' ||
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${i + 1}/${maxRetries})`,
          );
          console.error('Error:', err.message);

          // 等待一段时间后重试
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 尝试重新连接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 创建客户端的工厂函数
export function createRedisClient(
  config: RedisConnectionConfig,
  globalSymbol: symbol,
): RedisClientType {
  let client: RedisClientType | undefined = (global as any)[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 创建客户端配置
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重连策略：指数退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(
            `${config.clientName} reconnection attempt ${retries + 1}`,
          );
          if (retries > 10) {
            console.error(
              `${config.clientName} max reconnection attempts exceeded`,
            );
            return false; // 停止重连
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避，最大30秒
        },
        connectTimeout: 10000, // 10秒连接超时
        // 设置no delay，减少延迟
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持连接活跃
      // 添加命令超时，防止命令无限期等待
      commandsQueueMaxLength: 1000, // 命令队列最大长度
      disableOfflineQueue: false, // 允许离线队列
    };

    client = createClient(clientConfig);

    // 添加错误事件监听
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始连接，带重试机制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalSymbol] = client;
  }

  return client;
}

// 抽象基类，包含所有通用的Redis操作逻辑
export abstract class BaseRedisStorage implements IStorage {
  protected client: RedisClientType;
  protected config: RedisConnectionConfig;
  protected withRetry: <T>(
    operation: () => Promise<T>,
    maxRetries?: number,
  ) => Promise<T>;

  constructor(config: RedisConnectionConfig, globalSymbol: symbol) {
    this.config = config; // 保存配置
    this.client = createRedisClient(config, globalSymbol);
    this.withRetry = createRetryWrapper(config.clientName, () => this.client);
  }
  getClient(): RedisClientType {
    return this.client;
  }

  private scanKeys(pattern: string): Promise<string[]> {
    return this.withRetry(async () => {
      const keys: string[] = [];
      for await (const page of this.client.scanIterator({
        MATCH: pattern,
        COUNT: 200,
      })) {
        const pageKeys = Array.isArray(page) ? page : [page];
        keys.push(...pageKeys.map(ensureString));
      }
      return keys;
    });
  }

  // ---------- 播放记录 ----------
  // 使用 Hash 结构存储所有播放记录，提升性能
  private prHashKey(user: string) {
    return `u:${user}:playrecords`; // 单个 Hash 存储所有播放记录
  }

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    const val = await this.withRetry(() =>
      this.client.hGet(this.prHashKey(userName), key),
    );
    return val ? parseStoredJson<PlayRecord>(val) : null;
  }

  async savePlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(this.prHashKey(userName), key, JSON.stringify(record)),
    );
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<Record<string, PlayRecord>> {
    const allRecords = await this.withRetry(() =>
      this.client.hGetAll(this.prHashKey(userName)),
    );
    const result: Record<string, PlayRecord> = {};
    for (const [key, value] of Object.entries(allRecords)) {
      if (value) {
        result[key] = parseStoredJson<PlayRecord>(value);
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.hDel(this.prHashKey(userName), key));
  }

  // ---------- 收藏 ----------
  // 使用 Hash 结构存储所有收藏，提升性能
  private favHashKey(user: string) {
    return `u:${user}:favorites`; // 单个 Hash 存储所有收藏
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.client.hGet(this.favHashKey(userName), key),
    );
    return val ? parseStoredJson<Favorite>(val) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(
        this.favHashKey(userName),
        key,
        JSON.stringify(favorite),
      ),
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const allFavorites = await this.withRetry(() =>
      this.client.hGetAll(this.favHashKey(userName)),
    );

    const result: Record<string, Favorite> = {};
    for (const [key, value] of Object.entries(allFavorites)) {
      if (value) {
        result[key] = parseStoredJson<Favorite>(value);
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() =>
      this.client.hDel(this.favHashKey(userName), key),
    );
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await this.hashPassword(newPassword);
    await this.withRetry(() =>
      this.client.hSet(this.userInfoKey(userName), 'password', hashedPassword),
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码 (V1)
    await this.withRetry(() => this.client.del(`u:${userName}:pwd`));

    // 获取 OIDC 信息以便后续清理 (需要在删除用户信息前获取)
    let oidcSub: string | undefined;
    try {
      const userInfo = await this.getUserInfo(userName);
      oidcSub = userInfo?.oidcSub;
    } catch (e) {
      // 忽略错误
    }

    // 删除用户信息 (V2)
    await this.withRetry(() => this.client.del(this.userInfoKey(userName)));

    // 从用户列表中移除 (V2)
    await this.withRetry(() => this.client.zRem(this.userListKey(), userName));

    // 删除 OIDC 映射（如果存在）
    if (oidcSub) {
      await this.withRetry(() => this.client.del(this.oidcSubKey(oidcSub!)));
    }

    // 删除搜索历史
    await this.withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录 (新 Hash 结构)
    await this.withRetry(() => this.client.del(this.prHashKey(userName)));

    // 删除收藏夹 (新 Hash 结构)
    await this.withRetry(() => this.client.del(this.favHashKey(userName)));

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await this.scanKeys(skipConfigPattern);
    if (skipConfigKeys.length > 0) {
      await this.withRetry(() => this.client.del(skipConfigKeys));
    }

    // 删除剧集跳过配置
    const episodeSkipPattern = `u:${userName}:episodeskip:*`;
    const episodeSkipKeys = await this.scanKeys(episodeSkipPattern);
    if (episodeSkipKeys.length > 0) {
      await this.withRetry(() => this.client.del(episodeSkipKeys));
    }

    // 删除用户登入统计数据
    const loginStatsKey = `user_login_stats:${userName}`;
    await this.withRetry(() => this.client.del(loginStatsKey));

    // 删除历史影片
    const userMovieHis = `user_movie_his:${userName}`;
    await this.withRetry(() => this.client.del(userMovieHis));
  }

  // ---------- 用户相关（新版本 V2，支持 OIDC） ----------
  private userInfoKey(user: string) {
    return `u:${user}:info`;
  }

  private userListKey() {
    return 'users:list';
  }

  private oidcSubKey(oidcSub: string) {
    return `oidc:sub:${oidcSub}`;
  }

  // SHA256加密密码
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 创建新用户（新版本）
  async createUser(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[],
  ): Promise<Record<string, string>> {
    const hashedPassword = await this.hashPassword(password);
    const createdAt = Date.now();

    // 存储用户信息到Hash
    const userInfo: Record<string, string> = {
      role,
      banned: 'false',
      password: hashedPassword,
      created_at: createdAt.toString(),
    };

    if (tags && tags.length > 0) {
      userInfo.tags = JSON.stringify(tags);
    }

    if (enabledApis && enabledApis.length > 0) {
      userInfo.enabledApis = JSON.stringify(enabledApis);
    }

    if (oidcSub) {
      const namespacedOidcSub = assertNamespacedOidcSub(oidcSub);
      userInfo.oidcSub = namespacedOidcSub;
      // 创建OIDC映射
      await this.withRetry(() =>
        this.client.set(this.oidcSubKey(namespacedOidcSub), userName),
      );
    }

    await this.withRetry(() =>
      this.client.hSet(this.userInfoKey(userName), userInfo),
    );

    // 添加到用户列表（Sorted Set，按注册时间排序）
    await this.withRetry(() =>
      this.client.zAdd(this.userListKey(), {
        score: createdAt,
        value: userName,
      }),
    );
    return userInfo;
  }

  // 验证用户密码（新版本）
  async verifyUser(userName: string, password: string): Promise<boolean> {
    const userInfo = await this.withRetry(() =>
      this.client.hGetAll(this.userInfoKey(userName)),
    );

    if (!userInfo || !userInfo.password) {
      return false;
    }

    const hashedPassword = await this.hashPassword(password);
    return userInfo.password === hashedPassword;
  }

  // 获取用户信息（新版本）
  async getUserInfo(userName: string): Promise<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    banned: boolean;
    tags?: string[];
    oidcSub?: string;
    enabledApis?: string[];
    createdAt?: number;
  } | null> {
    const userInfo = await this.withRetry(() =>
      this.client.hGetAll(this.userInfoKey(userName)),
    );

    if (!userInfo || Object.keys(userInfo).length === 0) {
      return null;
    }

    // 安全解析 tags 字段
    let parsedTags: string[] | undefined;
    if (userInfo.tags) {
      try {
        // 如果 tags 已经是数组（某些 Redis 客户端行为），直接使用
        if (Array.isArray(userInfo.tags)) {
          parsedTags = userInfo.tags;
        } else {
          // 尝试 JSON 解析
          const parsed = JSON.parse(userInfo.tags);
          parsedTags = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch (_e) {
        // JSON 解析失败，可能是单个字符串值
        console.warn(`用户 ${userName} tags 解析失败，原始值:`, userInfo.tags);
        // 如果是逗号分隔的字符串
        if (typeof userInfo.tags === 'string' && userInfo.tags.includes(',')) {
          parsedTags = userInfo.tags.split(',').map((t) => t.trim());
        } else if (typeof userInfo.tags === 'string') {
          parsedTags = [userInfo.tags];
        }
      }
    }

    // 安全解析 enabledApis 字段
    let parsedApis: string[] | undefined;
    if (userInfo.enabledApis) {
      try {
        if (Array.isArray(userInfo.enabledApis)) {
          parsedApis = userInfo.enabledApis;
        } else {
          const parsed = JSON.parse(userInfo.enabledApis);
          parsedApis = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch (_e) {
        console.warn(`用户 ${userName} enabledApis 解析失败`);
        if (
          typeof userInfo.enabledApis === 'string' &&
          userInfo.enabledApis.includes(',')
        ) {
          parsedApis = userInfo.enabledApis.split(',').map((t) => t.trim());
        } else if (typeof userInfo.enabledApis === 'string') {
          parsedApis = [userInfo.enabledApis];
        }
      }
    }

    return {
      username: userName,
      role: (userInfo.role as 'owner' | 'admin' | 'user') || 'user',
      banned: userInfo.banned === 'true',
      tags: parsedTags,
      oidcSub: userInfo.oidcSub,
      enabledApis: parsedApis,
      createdAt: userInfo.created_at
        ? parseInt(userInfo.created_at, 10)
        : undefined,
    };
  }

  // 检查用户是否存在（新版本）
  async checkUserExist(userName: string): Promise<boolean> {
    const exists = await this.withRetry(() =>
      this.client.exists(this.userInfoKey(userName)),
    );
    return exists === 1;
  }

  // 通过OIDC Sub查找用户名
  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    const userName = await this.withRetry(() =>
      this.client.get(this.oidcSubKey(oidcSub)),
    );
    return userName ? ensureString(userName) : null;
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1),
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大长度
    await this.withRetry(() =>
      this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1),
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() =>
        this.client.lRem(key, 0, ensureString(keyword)),
      );
    } else {
      await this.withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    // 获取 V2 用户（u:*:info）
    const v2Keys = await this.scanKeys('u:*:info');
    const v2Users = v2Keys
      .map((k) => {
        const match = k.match(/^u:(.+?):info$/);
        return match ? ensureString(match[1]) : undefined;
      })
      .filter((u): u is string => typeof u === 'string');

    // 合并并去重（V2 优先，因为可能同时存在 V1 和 V2）
    const allUsers = new Set([...v2Users]);
    return Array.from(allUsers);
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.adminConfigKey()),
    );
    return val ? parseStoredJson<AdminConfig>(val) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config)),
    );
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<EpisodeSkipConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id)),
    );
    return val ? parseStoredJson<EpisodeSkipConfig>(val) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig,
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(
        this.skipConfigKey(userName, source, id),
        JSON.stringify(config),
      ),
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id)),
    );
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await this.scanKeys(pattern);

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: EpisodeSkipConfig } = {};

    // 批量获取所有配置
    const values = await this.withRetry(() => this.client.mGet(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = parseStoredJson<EpisodeSkipConfig>(value);
        }
      }
    });

    return configs;
  }

  // ---------- 剧集跳过配置（新版，多片段支持）----------
  private episodeSkipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:episodeskip:${source}+${id}`;
  }

  async getEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<EpisodeSkipConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.episodeSkipConfigKey(userName, source, id)),
    );
    return val ? parseStoredJson<EpisodeSkipConfig>(val) : null;
  }

  async saveEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig,
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(
        this.episodeSkipConfigKey(userName, source, id),
        JSON.stringify(config),
      ),
    );
  }

  async deleteEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.del(this.episodeSkipConfigKey(userName, source, id)),
    );
  }

  async getAllEpisodeSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    const pattern = `u:${userName}:episodeskip:*`;
    const keys = await this.scanKeys(pattern);

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: EpisodeSkipConfig } = {};

    // 批量获取所有配置
    const values = await this.withRetry(() => this.client.mGet(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:episodeskip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = parseStoredJson<EpisodeSkipConfig>(value);
        }
      }
    });

    return configs;
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await this.withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }

  // 一次并行读取统计依赖，避免管理员页面先通过 getUserStat 扫描播放记录，
  // 随后又通过 getAllPlayRecords 重复扫描同一个 Hash。
  async getUserStatsSnapshot(userName: string): Promise<UserStatsSnapshot> {
    const loginStatsKey = `user_login_stats:${userName}`;
    const userMovieHis = `user_movie_his:${userName}`;
    const [playRecords, storedLoginStats, totalMovies] = await Promise.all([
      this.getAllPlayRecords(userName),
      this.withRetry(() => this.client.get(loginStatsKey)),
      this.withRetry(() => this.client.sCard(userMovieHis)),
    ]);
    const records = Object.values(playRecords);
    const userStat: UserStat = storedLoginStats
      ? parseStoredJson<UserStat>(storedLoginStats)
      : { username: userName };
    const totalWatchTime = userStat.totalWatchTime || 0;
    const totalPlays = userStat.totalPlays || 0;

    userStat.totalMovies = totalMovies;
    userStat.avgWatchTime = totalPlays > 0 ? totalWatchTime / totalPlays : 0;
    if (records.length > 0) {
      userStat.recentRecords = records
        .sort((a, b) => (b.save_time || 0) - (a.save_time || 0))
        .slice(0, 10);
      const sourceMap = new Map<string, number>();
      records.forEach((record) => {
        const sourceName = record.source_name || '未知来源';
        sourceMap.set(sourceName, (sourceMap.get(sourceName) || 0) + 1);
      });
      userStat.mostWatchedSource = Array.from(sourceMap.entries()).reduce(
        (mostWatched, current) =>
          mostWatched[1] > current[1] ? mostWatched : current,
      )[0];
    }

    return {
      playRecords,
      userStat: {
        ...userStat,
        username: userStat.username || userName,
        totalWatchTime,
        totalPlays,
        lastPlayTime: userStat.lastPlayTime ?? userStat.lastLoginTime ?? 0,
        mostWatchedSource: userStat.mostWatchedSource ?? '',
        recentRecords: userStat.recentRecords ?? [],
        totalMovies: userStat.totalMovies ?? 0,
        firstWatchDate:
          userStat.firstWatchDate ?? userStat.lastPlayTime ?? Date.now(),
        loginCount: userStat.loginCount ?? 0,
        lastLoginTime: userStat.lastLoginTime ?? 0,
      },
    };
  }

  // 获取用户播放统计
  async getUserStat(userName: string): Promise<UserStat> {
    try {
      return (await this.getUserStatsSnapshot(userName)).userStat;
    } catch (error) {
      console.error(`获取用户 ${userName} 统计失败:`, error);
      return {
        username: userName,
        totalWatchTime: 0,
        totalPlays: 0,
        lastPlayTime: 0,
        recentRecords: [],
        avgWatchTime: 0,
        mostWatchedSource: '',
        totalMovies: 0,
        firstWatchDate: Date.now(),
        loginCount: 0,
        lastLoginTime: 0,
      };
    }
  }

  // 更新用户统计
  async updateUserStats(
    username: string,
    playRecord?: PlayRecord,
  ): Promise<UserStat> {
    try {
      const loginStatsKey = `user_login_stats:${username}`;

      // 获取当前登入统计数据
      const currentStats = await this.client.get(loginStatsKey);
      const userStat: UserStat = currentStats
        ? parseStoredJson<UserStat>(currentStats)
        : {
            username,
          };
      if (!userStat.username) {
        userStat.username = username;
      }
      const ct = Date.now();
      if (!userStat.lastLoginTime) {
        userStat.lastLoginTime = ct;
        userStat.loginCount = 1;
      }
      if (ct - userStat.lastLoginTime > 8 * 60 * 60 * 1000) {
        userStat.loginCount = (userStat.loginCount || 0) + 1;
        userStat.lastLoginTime = ct;
      }
      if (
        !userStat.totalWatchTime ||
        !userStat.totalPlays ||
        !userStat.firstWatchDate
      ) {
        const userPlayRecords = await db.getAllPlayRecords(userStat.username);
        const records = Object.values(userPlayRecords);
        if (records.length !== 0) {
          if (!userStat.totalWatchTime) {
            userStat.totalWatchTime = records.reduce((sum, record) => {
              return sum + (record.play_time || 0);
            }, 0);
          }
          if (!userStat.totalPlays) {
            userStat.totalPlays = records.length;
          }
          if (!userStat.firstWatchDate) {
            userStat.firstWatchDate = Math.min(
              ...records.map((r) => r.save_time || Date.now()),
            );
          }
        }
      }
      if (playRecord) {
        await updateWatchTime(playRecord, userStat);
        if (ct - userStat.lastPlayTime > 10 * 60 * 1000) {
          userStat.totalPlays += 1;
        }
        userStat.lastPlayTime = ct;
      }
      // 保存更新后的统计数据
      await this.client.set(loginStatsKey, JSON.stringify(userStat));
      return userStat;
    } catch (error) {
      console.error(`更新用户 ${username}  统计失败:`, error);
      throw error;
    }
  }
}

/**
 * 更新用户统计数据
 * 智能计算观看时间增量，支持防刷机制
 */
export async function updateWatchTime(
  record: PlayRecord,
  userStat: UserStat,
): Promise<void> {
  if (!record.key) return;
  try {
    const existingRecord = await db.getPlayRecord(
      userStat.username,
      record.key,
    );
    if (!existingRecord) return;
    // 获取上次播放进度和更新时间
    const lastProgress = existingRecord.play_time;
    const lastUpdateTime = existingRecord.last_tj_time;

    // 计算观看时间增量
    let watchTimeIncrement = 0;
    const currentTime = Date.now();
    const timeSinceLastUpdate = currentTime - lastUpdateTime;

    // 放宽更新条件：只要有实际播放进度变化就更新
    if (timeSinceLastUpdate < 10 * 1000) {
      console.log(
        `跳过统计数据更新: 时间间隔过短 (${Math.floor(timeSinceLastUpdate / 1000)}s)`,
      );
      return;
    }

    // 改进的观看时间计算逻辑
    if (record.play_time > lastProgress) {
      // 正常播放进度增加
      watchTimeIncrement = record.play_time - lastProgress;
      // 如果进度增加过大（可能是快进），限制增量
      if (watchTimeIncrement > 300) {
        // 超过5分钟认为是快进
        watchTimeIncrement = 60;
        console.log(
          `检测到快进操作: ${record.title} 第${record.index}集 - 进度增加: ${record.play_time - lastProgress}s, 限制增量为: ${watchTimeIncrement}s`,
        );
      }
    }
    console.log(
      `用户(${userStat.username})观看时间增量计算: ${record.title} 第${record.index}集 - 增量: ${watchTimeIncrement}s`,
    );
    // 只要有观看时间增量就更新统计数据
    if (watchTimeIncrement > 0) {
      userStat.totalWatchTime += watchTimeIncrement;
    }
  } catch (error) {
    console.error('更新用户统计数据失败:', error);
  }
}
