import 'server-only';

import { db } from '@/lib/db';

export async function getCache(key: string): Promise<any | null> {
  try {
    const cached = await db.getCache(key);
    if (!key.startsWith('video-search') && cached) {
      console.log(`✅ 缓存命中: key = ${key}`);
    }
    return cached;
  } catch (error) {
    // localStorage 模式没有服务端存储实例，与旧实现一致按未命中处理。
    if (
      (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !==
      'localstorage'
    ) {
      console.warn('读取服务端缓存失败:', error);
    }
    return null;
  }
}

export async function setCache(
  key: string,
  data: any,
  expireSeconds: number,
): Promise<void> {
  try {
    await db.setCache(key, data, expireSeconds);
    if (!key.startsWith('video-search')) {
      console.log(`✅ 写入缓存成功: key = ${key}, expire = ${expireSeconds}`);
    }
  } catch (error) {
    if (
      (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !==
      'localstorage'
    ) {
      console.warn('写入服务端缓存失败:', error);
    }
  }
}

// 共享的数据抓取模块同时供浏览器与 Route Handler 使用。服务端入口加载
// 本模块后注册运行时实现，让共享模块无需引用 db，也不会把 Redis/Node crypto
// 的浏览器 polyfill 带进首页客户端资源。
(
  globalThis as typeof globalThis & {
    __serverCacheRuntime?: {
      get: typeof getCache;
      set: typeof setCache;
    };
  }
).__serverCacheRuntime = { get: getCache, set: setCache };
