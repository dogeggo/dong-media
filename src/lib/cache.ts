// 豆瓣数据缓存配置（秒）
export const DOUBAN_CACHE_EXPIRE = {
  details: 7 * 24 * 60 * 60, // 详情4小时（变化较少）
  details_failure: 30 * 60, // 详情失败缓存30分钟
  lists: 4 * 60 * 60, // 列表2小时（更新频繁）
  categories: 4 * 60 * 60, // 分类2小时
  recommends: 4 * 60 * 60, // 推荐2小时
  comments: 7 * 24 * 60 * 60, // 短评1小时（更新频繁）
  platform_link: 7 * 24 * 60 * 60, // 平台链接
  trailer_url: 4 * 60 * 60,
  danmu: 24 * 60 * 60,
  top250: 24 * 60 * 60,
};

// 短剧数据缓存配置（秒）
export const SHORTDRAMA_CACHE_EXPIRE = {
  details: 4 * 60 * 60, // 详情4小时（变化较少）
  lists: 2 * 60 * 60, // 列表2小时（更新频繁）
  categories: 4 * 60 * 60, // 分类4小时（很少变化）
  recommends: 1 * 60 * 60, // 推荐1小时（经常更新）
};

// TMDB数据缓存配置（秒）
export const TMDB_CACHE_EXPIRE = {
  actor_search: 6 * 60 * 60, // 演员搜索6小时（较稳定）
  person_details: 24 * 60 * 60, // 人物详情24小时（基本不变）
  movie_credits: 12 * 60 * 60, // 演员电影作品12小时（较稳定）
  tv_credits: 12 * 60 * 60, // 演员电视剧作品12小时（较稳定）
  movie_details: 24 * 60 * 60, // 电影详情24小时（基本不变）
  tv_details: 24 * 60 * 60, // 电视剧详情24小时（基本不变）
  trending: 2 * 60 * 60, // 热门内容2小时（更新频繁）
  discover: 4 * 60 * 60, // 发现内容4小时
};

// 其他接口缓存配置（秒）
export const NETDISK_CACHE_EXPIRE = {
  search: 30 * 60, // 搜索30分钟
};

export const YOUTUBE_CACHE_EXPIRE = {
  search: 30 * 60, // 搜索60分钟
  search_fallback: 5 * 60, // 失败兜底5分钟
};

export const SEARCH_CACHE_EXPIRE: number = 1 * 60 * 60;

const DEFAULT_CACHE_PREFIXES = [
  'douban-',
  'tmdb-',
  'shortdrama-',
  'netdisk-',
  'bangumi-',
  'danmu-',
];

type ServerCacheRuntime = {
  get: (key: string) => Promise<any | null>;
  set: (key: string, data: any, expireSeconds: number) => Promise<void>;
};

function getServerCacheRuntime(): ServerCacheRuntime | undefined {
  return (
    globalThis as typeof globalThis & {
      __serverCacheRuntime?: ServerCacheRuntime;
    }
  ).__serverCacheRuntime;
}

type CacheCleanerState = {
  started: boolean;
  intervalId?: number;
  idleId?: number;
  timeoutId?: number;
};

function getCacheCleanerState(): CacheCleanerState | null {
  if (typeof window === 'undefined') return null;
  const win = window as typeof window & {
    __cacheCleanerState?: CacheCleanerState;
  };
  if (!win.__cacheCleanerState) {
    win.__cacheCleanerState = { started: false };
  }
  return win.__cacheCleanerState;
}

// 在客户端显式初始化缓存清理（避免模块加载副作用）
export function initCacheCleaner(options?: {
  intervalMs?: number;
  prefixes?: string[];
}): void {
  const state = getCacheCleanerState();
  if (!state || state.started) return;

  state.started = true;
  const prefixes = options?.prefixes ?? DEFAULT_CACHE_PREFIXES;

  const scheduleCleanup = () => {
    const run = () => {
      state.idleId = undefined;
      state.timeoutId = undefined;
      cleanExpiredCaches(prefixes);
    };

    if (typeof window.requestIdleCallback === 'function') {
      state.idleId = window.requestIdleCallback(run, { timeout: 3000 });
    } else {
      state.timeoutId = window.setTimeout(run, 500);
    }
  };

  scheduleCleanup();

  const intervalMs = options?.intervalMs ?? 10 * 60 * 1000;
  state.intervalId = window.setInterval(scheduleCleanup, intervalMs);
}

// 缓存工具函数
export function getDouBanCacheKey(
  prefix: string,
  params: Record<string, any>,
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return `douban-${prefix}-${sortedParams}`;
}

// 缓存工具函数
export function getShortdramaCacheKey(
  prefix: string,
  params: Record<string, any>,
): string {
  const sortedParams = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return `shortdrama-${prefix}-${sortedParams}`;
}

// 缓存工具函数
export function getTMDBCacheKey(
  prefix: string,
  params: Record<string, any>,
): string {
  const sortedParams = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return `tmdb-${prefix}-${sortedParams}`;
}

// 获取缓存状态信息
export function getTMDBCacheStats(): {
  totalItems: number;
  totalSize: number;
  byType: Record<string, number>;
} {
  if (typeof localStorage === 'undefined') {
    return { totalItems: 0, totalSize: 0, byType: {} };
  }

  const keys = Object.keys(localStorage).filter((key) =>
    key.startsWith('tmdb-'),
  );
  const byType: Record<string, number> = {};
  let totalSize = 0;

  keys.forEach((key) => {
    const type = key.split('-')[1]; // tmdb-{type}-{params}
    byType[type] = (byType[type] || 0) + 1;

    const data = localStorage.getItem(key);
    if (data) {
      totalSize += data.length;
    }
  });

  return {
    totalItems: keys.length,
    totalSize,
    byType,
  };
}

// 统一缓存获取方法
export async function getCache(key: string): Promise<any | null> {
  try {
    if (typeof window === 'undefined') {
      return (await getServerCacheRuntime()?.get(key)) ?? null;
    }

    // 兜底：从localStorage获取（兼容性）
    if (typeof localStorage !== 'undefined') {
      const localCached = localStorage.getItem(key);
      if (localCached) {
        const { data, expire } = JSON.parse(localCached);
        if (Date.now() <= expire) {
          if (!key.startsWith('video-search')) {
            console.log(`✅ 缓存命中: key = ${key}`);
          }
          return data;
        }
        localStorage.removeItem(key);
      }
    }
    return null;
  } catch (e) {
    console.warn('获取缓存失败:', e);
    return null;
  }
}

// 统一缓存设置方法
export async function setCache(
  key: string,
  data: any,
  expireSeconds: number,
): Promise<void> {
  try {
    if (typeof window === 'undefined') {
      await getServerCacheRuntime()?.set(key, data, expireSeconds);
      return;
    }

    // 兜底存储：localStorage（兼容性，短期缓存）
    if (typeof localStorage !== 'undefined') {
      try {
        const cacheData = {
          data,
          expire: Date.now() + expireSeconds * 1000,
          created: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(cacheData));
        if (!key.startsWith('video-search')) {
          console.log(
            `✅ 写入缓存成功: key = ${key}, expire = ${expireSeconds}`,
          );
        }
      } catch (_e) {
        // localStorage可能满了，忽略错误
      }
    }
  } catch (e) {
    console.warn('设置缓存失败:', e);
  }
}

// 清理过期缓存
export async function cleanExpiredCache(prefix: string): Promise<void> {
  cleanExpiredCaches([prefix]);
}

function cleanExpiredCaches(prefixes: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      const now = Date.now();

      // 一次遍历完成全部缓存前缀的清理，避免首页启动时重复扫描
      // localStorage 并反复 JSON.parse。
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
          try {
            const cached = localStorage.getItem(key);
            if (cached) {
              const { expire } = JSON.parse(cached);
              if (typeof expire === 'number' && now > expire) {
                keysToRemove.push(key);
              }
            }
          } catch (_e) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    }
  } catch (e) {
    console.warn('清理过期缓存失败:', e);
  }
}
