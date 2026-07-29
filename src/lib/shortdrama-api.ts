/* eslint-disable no-console */

import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

import { ShortDramaCategory, ShortDramaItem } from './types';

const getApiBase = async () => {
  if (typeof window !== 'undefined') {
    return '/api/shortdrama';
  }
  const { loadConfig } = await import('@/lib/config');
  const config = await loadConfig();
  const urls = config.ShortDramaConfig.primaryApiUrl
    .split(';')
    .map((url) => url.trim())
    .filter(Boolean);
  if (!urls.length) throw new Error('短剧 API 未配置');
  // 服务端使用外部API的完整路径
  return urls[0];
};

const getSearchUrls = async () => {
  if (typeof window === 'undefined') {
    const { loadConfig } = await import('@/lib/config');
    const config = await loadConfig();
    const urls = config.ShortDramaConfig.primaryApiUrl
      .split(';')
      .map((url) => url.trim())
      .filter(Boolean);
    // 服务端使用外部API的完整路径
    return urls;
  }
  return [];
};

export interface ShortDramaDetailOptions {
  id: string;
  videoId: number;
  episode: number;
  name?: string;
}

const getEpisodeCount = (item: any) => {
  const total = item?.vod_total;
  if (total > 0) return total;

  const serial = item?.vod_serial;
  if (serial > 0) return serial;

  return 1;
};

const getShortDramaCategoryId = async (baseUrl: string) => {
  const listUrl = `${baseUrl}?ac=list`;

  const listResponse = await fetch(listUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!listResponse.ok) {
    throw new Error(`HTTP error! status: ${listResponse.status}`);
  }

  const listData = await listResponse.json();
  const categories = listData.class || [];

  // 查找"短剧"分类（只要包含"短剧"两个字即可）
  const shortDramaCategory = categories.find(
    (cat: any) => cat.type_name && cat.type_name.includes('短剧'),
  );

  if (!shortDramaCategory) {
    console.log(`该源没有短剧分类`);
    return null;
  }

  const categoryId = shortDramaCategory.type_id;
  return categoryId;
};

// 获取短剧分类列表
export async function getShortDramaCategories(): Promise<ShortDramaCategory[]> {
  return [
    {
      type_id: 1,
      type_name: '全部短剧',
    },
  ];
}

// 获取推荐短剧列表
export async function getRecommendedShortDramas(
  size = 15,
): Promise<ShortDramaItem[]> {
  try {
    let result: ShortDramaItem[];
    if (typeof window === 'undefined') {
      result = await fetchFromShortDramaSource(size);
    } else {
      // 使用内部 API 代理
      const params = new URLSearchParams();
      params.append('size', size.toString());
      const apiUrl = `${await getApiBase()}/recommend?${params.toString()}`;

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      result = await response.json();
    }
    return result;
  } catch (error) {
    console.error('获取推荐短剧失败:', error);
    if (typeof window === 'undefined') throw error;
    return [];
  }
}

// 从单个短剧源获取数据
async function fetchFromShortDramaSource(size: number) {
  // Step 1: 获取分类列表，找到"短剧"分类的ID
  const apiBase = await getApiBase();
  const categoryId = await getShortDramaCategoryId(apiBase);
  if (categoryId == null) {
    return [];
  }

  // Step 2: 获取该分类的短剧列表
  const apiUrl = `${apiBase}?ac=detail&t=${categoryId}&pg=1`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const items = data.list || [];

  return items.slice(0, size).map((item: any) => ({
    id: item.vod_id,
    name: item.vod_name,
    cover: item.vod_pic || '',
    update_time: item.vod_time || new Date().toISOString(),
    score: parseFloat(item.vod_score) || 0,
    episode_count: getEpisodeCount(item),
    description: item.vod_content || item.vod_blurb || '',
    author: item.vod_actor || '',
    backdrop: item.vod_pic_slide || item.vod_pic || '',
    vote_average: parseFloat(item.vod_score) || 0,
  }));
}

// 获取分类短剧列表（分页）
export async function getShortDramaList(
  category: number,
  page = 1,
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  try {
    let result: { list: []; hasMore: boolean };
    if (typeof window === 'undefined') {
      result = await fetchListFromSource(page);
    } else {
      // 使用内部 API 代理
      const apiUrl = `${await getApiBase()}/list?categoryId=${category}&page=${page}`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      result = await response.json();
    }
    return result;
  } catch (error) {
    console.error('获取短剧列表失败:', error);
    if (typeof window === 'undefined') throw error;
    return { list: [], hasMore: false };
  }
}

// 从单个短剧源获取数据（通过分类名称查找）
async function fetchListFromSource(page: number) {
  // Step 1: 获取分类列表，找到"短剧"分类的ID
  const apiBase = await getApiBase();
  const categoryId = await getShortDramaCategoryId(apiBase);
  if (categoryId == null) {
    return { list: [], hasMore: false };
  }

  // Step 2: 获取该分类的短剧列表
  const apiUrl = `${apiBase}?ac=detail&t=${categoryId}&pg=${page}`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const items = data.list || [];

  const list = items.map((item: any) => ({
    id: item.vod_id,
    name: item.vod_name,
    cover: item.vod_pic || '',
    update_time: item.vod_time || new Date().toISOString(),
    score: parseFloat(item.vod_score) || 0,
    episode_count: getEpisodeCount(item),
    description: item.vod_content || item.vod_blurb || '',
    author: item.vod_actor || '',
    backdrop: item.vod_pic_slide || item.vod_pic || '',
    vote_average: parseFloat(item.vod_score) || 0,
  }));

  return {
    list,
    hasMore: data.page < data.pagecount,
  };
}

// 搜索短剧
export async function searchShortDramas(
  query: string,
  page = 1,
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  try {
    if (typeof window === 'undefined') {
      // 有配置短剧源，聚合所有源的搜索结果
      const urls = await getSearchUrls();
      if (urls.length == 0) {
        return {
          list: [],
          hasMore: false,
        };
      }
      const results = await Promise.allSettled(
        urls.map((url) => searchFromSource(url, query, page)),
      );

      if (results.every((result) => result.status === 'rejected')) {
        throw new Error('所有短剧源搜索均失败');
      }

      // 合并所有成功的结果
      const allItems: any[] = [];
      let hasMore = false;

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          allItems.push(...result.value.list);
          hasMore = hasMore || result.value.hasMore;
        }
      });

      // 去重
      const uniqueItems = Array.from(
        new Map(allItems.map((item) => [item.name, item])).values(),
      );

      // 按更新时间排序
      uniqueItems.sort(
        (a, b) =>
          new Date(b.update_time).getTime() - new Date(a.update_time).getTime(),
      );

      return {
        list: uniqueItems,
        hasMore,
      };
    } else {
      // 使用内部 API 代理
      const apiUrl = `${await getApiBase()}/search?query=${encodeURIComponent(query)}&page=${page}`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result;
    }
  } catch (error) {
    console.error('搜索短剧失败:', error);
    if (typeof window === 'undefined') throw error;
    return { list: [], hasMore: false };
  }
}

async function searchFromSource(url: string, query: string, page: number) {
  // Step 1: 获取分类列表，找到"短剧"分类的ID
  const categoryId = await getShortDramaCategoryId(url);
  if (categoryId == null) {
    return { list: [], hasMore: false };
  }

  // Step 2: 搜索该分类下的短剧
  const apiUrl = `${url}?ac=detail&wd=${encodeURIComponent(query)}&pg=${page}`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const items = data.list || [];

  // 过滤出短剧分类的结果
  const shortDramaItems = items.filter(
    (item: any) => item.type_id === categoryId,
  );

  const list = shortDramaItems.map((item: any) => ({
    id: item.vod_id,
    name: item.vod_name,
    cover: item.vod_pic || '',
    update_time: item.vod_time || new Date().toISOString(),
    score: parseFloat(item.vod_score) || 0,
    episode_count: getEpisodeCount(item),
    description: item.vod_content || item.vod_blurb || '',
    author: item.vod_actor || '',
    backdrop: item.vod_pic_slide || item.vod_pic || '',
    vote_average: parseFloat(item.vod_score) || 0,
  }));

  return {
    list,
    hasMore: data.page < data.pagecount,
  };
}
