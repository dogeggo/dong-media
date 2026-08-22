import { AdminConfig } from './admin.types';
import { KvrocksStorage } from './kvrocks.db';
import { RedisStorage } from './redis.db';
import {
  EpisodeSkipConfig,
  Favorite,
  IStorage,
  PlayRecord,
  UserStat,
  UserStatsSnapshot,
} from './types';

// storage type 常量: 'localstorage' | 'redis' 默认 'localstorage'
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'kvrocks'
    | undefined) || 'localstorage';

// 创建存储实例
function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'redis':
      return new RedisStorage();
    case 'kvrocks':
      return new KvrocksStorage();
    case 'localstorage':
    default:
      return null;
  }
}

// 单例存储实例
let storageInstance: IStorage | null = null;

function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();
  }

  getClient() {
    return this.storage.getClient();
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    await this.storage.savePlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string,
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.storage.changePassword(userName, newPassword);
  }

  // ---------- 用户相关（新版本 V2，支持 OIDC） ----------
  async createUser(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[],
  ): Promise<Record<string, string>> {
    return await this.storage.createUser(
      userName,
      password,
      role,
      tags,
      oidcSub,
      enabledApis,
    );
  }

  async deleteUser(userName: string): Promise<void> {
    await this.storage.deleteUser(userName);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    return this.storage.getUserByOidcSub(oidcSub);
  }

  async getUserInfo(userName: string): Promise<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    tags?: string[];
    enabledApis?: string[];
    banned?: boolean;
    createdAt?: number;
    oidcSub?: string;
  } | null> {
    return this.storage.getUserInfo(userName);
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户名
  async getAllUserName(): Promise<string[]> {
    return this.storage.getAllUsers();
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.storage.getAdminConfig();
  }

  async saveAdminConfig(
    config: AdminConfig,
    options: { invalidateCache?: boolean } = {},
  ): Promise<void> {
    await this.storage.setAdminConfig(config);
    if (options.invalidateCache === false) return;
    const { cacheService } = await import('@/lib/cache-system');
    await cacheService.invalidateTags([
      'config',
      'sources',
      'live',
      'shortdrama',
      'youtube',
      'netdisk',
    ]);
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<EpisodeSkipConfig | null> {
    return this.storage.getSkipConfig(userName, source, id);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig,
  ): Promise<void> {
    await this.storage.setSkipConfig(userName, source, id, config);
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.storage.deleteSkipConfig(userName, source, id);
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    return this.storage.getAllSkipConfigs(userName);
  }

  // ---------- 剧集跳过配置（新版，多片段支持）----------
  async getEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<EpisodeSkipConfig | null> {
    return this.storage.getEpisodeSkipConfig(userName, source, id);
  }

  async saveEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig,
  ): Promise<void> {
    await this.storage.saveEpisodeSkipConfig(userName, source, id, config);
  }

  async deleteEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.storage.deleteEpisodeSkipConfig(userName, source, id);
  }

  async getAllEpisodeSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    return this.storage.getAllEpisodeSkipConfigs(userName);
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    await this.storage.clearAllData();
  }

  async getUserStat(userName: string): Promise<UserStat> {
    return this.storage.getUserStat(userName);
  }

  async getUserStatsSnapshot(userName: string): Promise<UserStatsSnapshot> {
    return this.storage.getUserStatsSnapshot(userName);
  }

  async updateUserStats(
    username: string,
    playRecord?: PlayRecord,
    existingPlayRecord?: PlayRecord | null,
  ): Promise<void> {
    await this.storage.updateUserStats(
      username,
      playRecord,
      existingPlayRecord,
    );
  }
}

// 导出默认实例
export const db = new DbManager();
