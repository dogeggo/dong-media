/* eslint-disable no-console */

import type { PlatformUrl } from '@/app/api/danmu-external/route';

import {
  DoubanApiResponse,
  DoubanCategoryApiResponse,
  DoubanCelebrity,
  DoubanComment,
  DoubanCommentsResult,
  DoubanMovieDetail,
  DoubanRecommendApiResponse,
  DoubanRecommendation,
  DoubanResult,
} from './types';

export class DoubanError extends Error {
  constructor(
    message: string,
    public code:
      | 'TIMEOUT'
      | 'RATE_LIMIT'
      | 'SERVER_ERROR'
      | 'PARSE_ERROR'
      | 'NETWORK_ERROR',
    public status?: number,
  ) {
    super(message);
    this.name = 'DoubanError';
  }
}

function getBackdropFromMobileData(data: any): string | undefined {
  let backdrop =
    data.cover?.image?.raw?.url ||
    data.cover?.image?.large?.url ||
    data.cover?.image?.normal?.url ||
    data.pic?.large ||
    undefined;

  if (backdrop) {
    backdrop = backdrop
      .replace('/view/photo/s/', '/view/photo/l/')
      .replace('/view/photo/m/', '/view/photo/l/')
      .replace('/view/photo/sqxs/', '/view/photo/l/')
      .replace('/s_ratio_poster/', '/l_ratio_poster/')
      .replace('/m_ratio_poster/', '/l_ratio_poster/');
  }

  return backdrop;
}

interface DoubanPhotoImage {
  height?: number;
  url?: string;
  width?: number;
}

interface DoubanPhotoItem {
  image?: {
    large?: DoubanPhotoImage;
    raw?: DoubanPhotoImage | null;
  };
  likers_count?: number;
}

interface DoubanPhotosResponse {
  photos?: DoubanPhotoItem[];
}

export async function fetchDoubanHeroBackdrop(
  id: string,
): Promise<string | undefined> {
  const { fetchDoubanWithAntiScraping } =
    await import('@/lib/douban-challenge');

  for (const kind of ['movie', 'tv'] as const) {
    const url = `https://m.douban.com/rexxar/api/v2/${kind}/${id}/photos?type=S&start=0&count=12`;
    const response = await fetchDoubanWithAntiScraping(url, {
      timeoutMs: 5_000,
      redirect: 'manual',
    });
    if (!response.ok) {
      await response.body?.cancel();
      continue;
    }

    const data = (await response.json()) as DoubanPhotosResponse;
    const candidates = (data.photos || [])
      .map((photo) => {
        const image = photo.image?.raw || photo.image?.large;
        return {
          height: image?.height || 0,
          likers: photo.likers_count || 0,
          url: image?.url,
          width: image?.width || 0,
        };
      })
      .filter(
        (image) =>
          image.url &&
          image.width >= 1_200 &&
          image.width / Math.max(image.height, 1) >= 1.25,
      )
      .sort(
        (left, right) =>
          right.width * right.height - left.width * left.height ||
          right.likers - left.likers,
      );

    const backdrop = candidates[0]?.url;
    if (backdrop) return backdrop.replace(/^http:/, 'https:');
  }

  return undefined;
}

type TrailerWithBackdrop = {
  trailerUrl?: string;
  backdrop?: string;
};

export async function fetchTrailerWithRetry(
  id: string,
  retryCount = 0,
  getTrailerUrl = true,
): Promise<TrailerWithBackdrop> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 2000; // 2秒后重试
  const startTime = Date.now();

  try {
    const { fetchDoubanWithAntiScraping } =
      await import('@/lib/douban-challenge');
    // 先尝试 movie 端点
    let url = `https://m.douban.com/rexxar/api/v2/movie/${id}`;
    // 添加超时控制
    const controller = new AbortController();
    let response = await fetchDoubanWithAntiScraping(url, {
      signal: controller.signal,
      timeoutMs: 10000,
      redirect: 'manual',
    });
    // 如果是 3xx 重定向，说明可能是电视剧，尝试 tv 端点
    if (response.status >= 300 && response.status < 400) {
      url = `https://m.douban.com/rexxar/api/v2/tv/${id}`;
      response = response = await fetchDoubanWithAntiScraping(url, {
        signal: controller.signal,
        timeoutMs: 10000,
      });
    }
    if (!response.ok) {
      throw new Error(`豆瓣API返回错误: ${response.status}`);
    }
    const data = await response.json();
    const trailerUrl = data.trailers?.[0]?.video_url;
    const backdrop = getBackdropFromMobileData(data);

    if (!trailerUrl) {
      console.warn(`[refresh-trailer] 影片 ${id} 没有预告片数据`);
      const cachedData = { trailerUrl: undefined, backdrop };
      if (getTrailerUrl) {
        throw new Error('该影片没有预告片');
      }
      return cachedData;
    }
    console.log(`[refresh-trailer] 影片 ${id} 刷新成功. url = ${trailerUrl}`);
    const cachedData = { trailerUrl, backdrop };
    return cachedData;
  } catch (error) {
    const failTime = Date.now() - startTime;
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('fetch'))
    ) {
      console.error(
        `[refresh-trailer] 影片 ${id} 请求失败 (耗时: ${failTime}ms): ${error.name === 'AbortError' ? '超时' : error.message}`,
      );
      if (retryCount < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return fetchTrailerWithRetry(id, retryCount + 1, getTrailerUrl);
      }
    }
    throw error;
  }
}

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

/**
 * 统一的豆瓣分类数据获取函数，根据代理设置选择使用服务端 API 或客户端代理获取
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams,
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;

  let result: DoubanResult;
  if (typeof window === 'undefined') {
    const url = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;
    console.log(`[豆瓣分类] 请求URL: ${url}`);
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(url);
    console.log(
      `[豆瓣分类] 成功获取数据，项目数: ${doubanData.items?.length || 0}`,
    );
    // 转换数据格式
    const list: DoubanMovieDetail[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.large || item.pic?.normal || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));
    result = {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } else {
    const response = await fetch(
      `/api/douban/categories?kind=${kind}&category=${category}&type=${type}&limit=${pageLimit}&start=${pageStart}`,
    );
    result = await response.json();
  }
  return result;
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

export async function getDoubanList(
  params: DoubanListParams,
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;

  let result: DoubanResult;
  if (typeof window === 'undefined') {
    const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${tag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanApiResponse>(url);
    // 转换数据格式
    const list: DoubanMovieDetail[] = doubanData.subjects.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: '',
    }));
    result = {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } else {
    const response = await fetch(
      `/api/douban?tag=${tag}&type=${type}&pageSize=${pageLimit}&pageStart=${pageStart}`,
    );
    result = await response.json();
  }
  return result;
}

interface DoubanRecommendsParams {
  kind: 'tv' | 'movie';
  pageLimit?: number;
  pageStart?: number;
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  year?: string;
  platform?: string;
  sort?: string;
}

export async function getDoubanRecommends(
  params: DoubanRecommendsParams,
): Promise<DoubanResult> {
  const {
    kind,
    pageLimit = 20,
    pageStart = 0,
    category,
    format,
    label,
    region,
    year,
    platform,
    sort,
  } = params;

  let result: DoubanResult;
  if (typeof window === 'undefined') {
    const selectedCategories = { 类型: category } as any;
    if (format) {
      selectedCategories['形式'] = format;
    }
    if (region) {
      selectedCategories['地区'] = region;
    }
    const tags = [] as Array<string>;
    if (category) {
      tags.push(category);
    }
    if (!category && format) {
      tags.push(format);
    }
    if (label) {
      tags.push(label);
    }
    if (region) {
      tags.push(region);
    }
    if (year) {
      tags.push(year);
    }
    if (platform) {
      tags.push(platform);
    }
    const baseUrl = `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
    const params = new URLSearchParams();
    params.append('refresh', '0');
    params.append('start', pageStart.toString());
    params.append('count', pageLimit.toString());
    params.append('selected_categories', JSON.stringify(selectedCategories));
    params.append('uncollect', 'false');
    params.append('score_range', '0,10');
    params.append('tags', tags.join(','));
    if (sort) {
      params.append('sort', sort);
    }
    const target = `${baseUrl}?${params.toString()}`;
    const doubanData =
      await fetchDoubanData<DoubanRecommendApiResponse>(target);
    const list = doubanData.items
      .filter((item) => item.type == 'movie' || item.type == 'tv')
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.large || item.pic?.normal || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));
    result = {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } else {
    const response = await fetch(
      `/api/douban/recommends?kind=${kind}&limit=${pageLimit}&start=${pageStart}&category=${category}&format=${format}&region=${region}&year=${year}&platform=${platform}&sort=${sort}&label=${label}`,
    );
    result = await response.json();
  }
  return result;
}

type PlatformLinksCache = {
  episodes: PlatformUrl[][];
  shared: PlatformUrl[];
};

function normalizePlatformUrl(rawUrl: string): string {
  let convertedUrl = rawUrl;

  // 优酷移动版转PC版
  if (convertedUrl.includes('m.youku.com/alipay_video/id_')) {
    convertedUrl = convertedUrl.replace(
      /https:\/\/m\.youku\.com\/alipay_video\/id_([^.]+)\.html/,
      'https://v.youku.com/v_show/id_$1.html',
    );
  }

  // 爱奇艺移动版转PC版
  if (convertedUrl.includes('m.iqiyi.com/')) {
    convertedUrl = convertedUrl.replace('m.iqiyi.com', 'www.iqiyi.com');
  }

  // 腾讯视频移动版转PC版
  if (convertedUrl.includes('m.v.qq.com/')) {
    convertedUrl = convertedUrl.replace('m.v.qq.com', 'v.qq.com');
  }

  // B站移动版转PC版
  if (convertedUrl.includes('m.bilibili.com/')) {
    convertedUrl = convertedUrl.replace('m.bilibili.com', 'www.bilibili.com');
    // 移除豆瓣来源参数
    convertedUrl = convertedUrl.split('?')[0];
  }

  return convertedUrl;
}

function dedupePlatformUrls(urls: PlatformUrl[]): PlatformUrl[] {
  const seen = new Set<string>();
  const result: PlatformUrl[] = [];

  urls.forEach((item) => {
    const key = `${item.platform}|${item.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });

  return result;
}

function parsePlatformLinksFromHtml(html: string): PlatformLinksCache {
  const episodes: PlatformUrl[][] = [];
  const shared: PlatformUrl[] = [];

  const pushEpisodeLink = (index: number, platform: string, url: string) => {
    if (!url) return;
    if (!episodes[index]) {
      episodes[index] = [];
    }
    episodes[index].push({ platform, url: normalizePlatformUrl(url) });
  };

  const pushSharedLink = (platform: string, url: string) => {
    if (!url) return;
    shared.push({ platform, url: normalizePlatformUrl(url) });
  };

  const decodeMatchUrl = (match: string, pattern: RegExp): string | null => {
    const urlMatch = match.match(pattern);
    if (!urlMatch) return null;
    try {
      return decodeURIComponent(urlMatch[0]).split('?')[0];
    } catch (_error) {
      return null;
    }
  };

  // 腾讯视频
  const doubanLinkMatches = html.match(/play_link:\s*"[^"]*v\.qq\.com[^"]*"/g);
  if (doubanLinkMatches && doubanLinkMatches.length > 0) {
    console.log(`🎬 找到 ${doubanLinkMatches.length} 个腾讯视频链接`);
    doubanLinkMatches.forEach((match, index) => {
      const decodedUrl = decodeMatchUrl(
        match,
        /https%3A%2F%2Fv\.qq\.com[^"&]*/,
      );
      if (decodedUrl) {
        pushEpisodeLink(index, 'tencent', decodedUrl);
      }
    });
  }

  // 爱奇艺
  const iqiyiMatches = html.match(/play_link:\s*"[^"]*iqiyi\.com[^"]*"/g);
  if (iqiyiMatches && iqiyiMatches.length > 0) {
    console.log(`📺 找到 ${iqiyiMatches.length} 个爱奇艺链接`);
    iqiyiMatches.forEach((match, index) => {
      const decodedUrl = decodeMatchUrl(
        match,
        /https?%3A%2F%2F[^"&]*iqiyi\.com[^"&]*/,
      );
      if (decodedUrl) {
        pushEpisodeLink(index, 'iqiyi', decodedUrl);
      }
    });
  }

  // 优酷
  const youkuMatches = html.match(/play_link:\s*"[^"]*youku\.com[^"]*"/g);
  if (youkuMatches && youkuMatches.length > 0) {
    console.log(`🎞️ 找到 ${youkuMatches.length} 个优酷链接`);
    youkuMatches.forEach((match, index) => {
      const decodedUrl = decodeMatchUrl(
        match,
        /https?%3A%2F%2F[^"&]*youku\.com[^"&]*/,
      );
      if (decodedUrl) {
        pushEpisodeLink(index, 'youku', decodedUrl);
      }
    });
  }

  // B站链接提取（豆瓣跳转链接）
  const biliDoubanMatches = html.match(
    /play_link:\s*"[^"]*bilibili\.com[^"]*"/g,
  );
  if (biliDoubanMatches && biliDoubanMatches.length > 0) {
    console.log(`📱 找到 ${biliDoubanMatches.length} 个B站豆瓣链接`);
    biliDoubanMatches.forEach((match, index) => {
      const decodedUrl = decodeMatchUrl(
        match,
        /https?%3A%2F%2F[^"&]*bilibili\.com[^"&]*/,
      );
      if (decodedUrl) {
        pushEpisodeLink(index, 'bilibili_douban', decodedUrl);
      }
    });
  }

  // 直接提取腾讯视频链接
  const qqMatches = html.match(/https:\/\/v\.qq\.com\/x\/cover\/[^"'\s]+/g);
  if (qqMatches && qqMatches.length > 0) {
    console.log(`🎭 找到直接腾讯链接: ${qqMatches[0]}`);
    pushSharedLink('tencent_direct', qqMatches[0].split('?')[0]);
  }

  // B站链接提取（直接链接）
  const biliMatches = html.match(
    /https:\/\/www\.bilibili\.com\/video\/[^"'\s]+/g,
  );
  if (biliMatches && biliMatches.length > 0) {
    console.log(`📺 找到B站直接链接: ${biliMatches[0]}`);
    pushSharedLink('bilibili', biliMatches[0].split('?')[0]);
  }

  const totalEpisodeLinks = episodes.reduce(
    (total, episodeLinks) => total + episodeLinks.length,
    0,
  );
  console.log(`✅ 总共提取到 ${totalEpisodeLinks + shared.length} 个平台链接`);

  return { episodes, shared };
}

function selectPlatformLinksFromCache(
  cache: PlatformLinksCache,
  episode?: string | null,
): PlatformUrl[] {
  const episodes = Array.isArray(cache.episodes) ? cache.episodes : [];
  const shared = Array.isArray(cache.shared) ? cache.shared : [];

  let episodeIndex = 0;
  if (episode) {
    const episodeNum = parseInt(episode);
    if (Number.isFinite(episodeNum) && episodeNum > 0) {
      episodeIndex = episodeNum - 1;
      console.log(`🎯 选择第${episode}集平台链接`);
    }
  }

  let episodeLinks = episodes[episodeIndex];
  if ((!episodeLinks || episodeLinks.length === 0) && episodes.length > 0) {
    episodeLinks = episodes[0] || [];
  }

  return dedupePlatformUrls([...(episodeLinks || []), ...shared]);
}

async function fetchDoubanSubjectHtml(doubanId: string): Promise<string> {
  const url = `https://movie.douban.com/subject/${doubanId}`;
  if (typeof window === 'undefined') {
    const { fetchDouBanHtml } = await import('@/lib/douban-challenge');
    return await fetchDouBanHtml(url, {
      timeoutMs: 10000,
    });
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  return await response.text();
}

async function fetchDoubanSubject(doubanId: string): Promise<{
  details?: DoubanResult;
  platformLinks: PlatformLinksCache;
}> {
  const html = await fetchDoubanSubjectHtml(doubanId);

  let platformLinks: PlatformLinksCache = { episodes: [], shared: [] };
  try {
    platformLinks = parsePlatformLinksFromHtml(html);
  } catch (error) {
    console.error('解析豆瓣详情页面失败:', error);
  }

  let details: DoubanResult | undefined;
  try {
    details = parseDoubanDetails(html, doubanId);
  } catch (error) {
    console.error('解析豆瓣详情页面失败:', error);
  }

  return { details, platformLinks };
}

/**
 * 获取豆瓣影片详细信息
 */
export async function getDoubanDetails(id: string): Promise<DoubanResult> {
  try {
    let result: DoubanResult;
    if (typeof window === 'undefined') {
      const { details } = await fetchDoubanSubject(id);
      if (!details) {
        throw new DoubanError('解析豆瓣详情页面失败', 'PARSE_ERROR');
      }
      result = details;
    } else {
      const response = await fetch(`/api/douban/details?id=${id}`);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      result = await response.json();
    }
    return result;
  } catch (error) {
    if (typeof window === 'undefined') throw error;
    return {
      code: 500,
      message: `获取豆瓣详情失败: ${(error as Error).message}`,
      list: [],
    };
  }
}

/**
 * 获取豆瓣影片短评
 */
interface DoubanCommentsParams {
  id: string;
  start?: number;
  limit?: number;
  sort?: 'new_score' | 'time';
}

interface DoubanInterestUser {
  id?: string;
  uid?: string;
  name?: string;
  avatar?: string;
  loc?: {
    name?: string;
  };
  url?: string;
}

interface DoubanInterestItem {
  comment?: string;
  rating?: {
    value?: number;
  };
  user?: DoubanInterestUser;
  create_time?: string;
  vote_count?: number;
  ip_location?: string;
}

interface DoubanInterestsApiResponse {
  count: number;
  start: number;
  total: number;
  interests: DoubanInterestItem[];
}

function parseDoubanInterests(
  data: DoubanInterestsApiResponse,
): DoubanComment[] {
  const interests = Array.isArray(data.interests) ? data.interests : [];
  const comments: DoubanComment[] = [];

  for (const item of interests) {
    const username = item.user?.name?.trim() || '';
    const content = item.comment?.trim() || '';
    if (!username || !content) continue;

    const userId = item.user?.id || item.user?.uid || '';
    const avatar = item.user?.avatar
      ? item.user.avatar.replace(/^http:/, 'https:')
      : '';
    const rating = Number(item.rating?.value || 0);
    const time = item.create_time || '';
    const location =
      item.user?.loc?.name?.trim() || item.ip_location?.trim() || '';
    const usefulCount = Number(item.vote_count || 0);

    comments.push({
      username,
      user_id: userId,
      avatar,
      rating,
      time,
      location,
      content,
      useful_count: usefulCount,
    });
  }
  return comments;
}

export async function getDoubanComments(
  params: DoubanCommentsParams,
): Promise<DoubanCommentsResult> {
  const { id, start = 0, limit = 10, sort = 'new_score' } = params;
  let result: DoubanCommentsResult;
  if (typeof window === 'undefined') {
    const params = new URLSearchParams({
      start: start.toString(),
      count: limit.toString(),
      status: 'P',
      sort,
    });
    let url = `https://m.douban.com/rexxar/api/v2/movie/${id}/interests?${params.toString()}`;
    let response: DoubanInterestsApiResponse;
    try {
      response = await fetchDoubanData<DoubanInterestsApiResponse>(url);
    } catch (_error) {
      url = `https://m.douban.com/rexxar/api/v2/tv/${id}/interests?${params.toString()}`;
      response = await fetchDoubanData<DoubanInterestsApiResponse>(url);
    }
    const comments = parseDoubanInterests(response);
    result = {
      code: 200,
      message: '获取成功',
      data: {
        comments,
        start,
        limit,
        count: comments.length,
      },
    };
  } else {
    try {
      const url = `/api/douban/comments?id=${id}&start=${start}&limit=${limit}&sort=${sort}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      result = await response.json();
    } catch (error) {
      return {
        code: 500,
        message: `获取豆瓣短评失败: ${(error as Error).message}`,
      };
    }
  }
  return result;
}

/**
 * 按演员名字搜索相关电影/电视剧
 */
interface DoubanActorSearchParams {
  actorName: string;
  type?: 'movie' | 'tv';
  pageLimit?: number;
  pageStart?: number;
}

export async function getDoubanActorMovies(
  params: DoubanActorSearchParams,
): Promise<DoubanResult> {
  const { actorName, type = 'movie', pageLimit = 20, pageStart = 0 } = params;

  // 验证参数
  if (!actorName?.trim()) {
    throw new Error('演员名字不能为空');
  }

  try {
    // 使用豆瓣搜索API
    const searchUrl = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(actorName.trim())}`;

    let html: string;
    if (typeof window === 'undefined') {
      const { fetchDouBanHtml } = await import('@/lib/douban-challenge');
      html = await fetchDouBanHtml(searchUrl, {
        timeoutMs: 10000,
      });
    } else {
      const response = await fetch(searchUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      html = await response.text();
    }
    // 解析HTML中的JSON数据
    const dataMatch = html.match(/window\.__DATA__\s*=\s*({.*?});/s);
    if (!dataMatch) {
      throw new Error('无法解析搜索结果数据');
    }

    const searchData = JSON.parse(dataMatch[1]);
    const items = searchData.items || [];

    // 过滤掉第一个结果（通常是演员本人的资料页）和不相关的结果
    let filteredItems = items.slice(1).filter((item: any) => {
      // 过滤掉书籍等非影视内容
      const abstract = item.abstract || '';
      const isBook =
        abstract.includes('出版') ||
        abstract.includes('页数') ||
        item.url?.includes('/book/');
      const isPerson = item.url?.includes('/celebrity/');
      return !isBook && !isPerson;
    });

    // 按类型过滤
    if (type === 'movie') {
      filteredItems = filteredItems.filter((item: any) => {
        const abstract = item.abstract || '';
        return (
          !abstract.includes('季') &&
          !abstract.includes('集') &&
          !abstract.includes('剧集')
        );
      });
    } else if (type === 'tv') {
      filteredItems = filteredItems.filter((item: any) => {
        const abstract = item.abstract || '';
        return (
          abstract.includes('季') ||
          abstract.includes('集') ||
          abstract.includes('剧集') ||
          abstract.includes('电视')
        );
      });
    }

    // 分页处理
    const startIndex = pageStart;
    const endIndex = startIndex + pageLimit;
    const paginatedItems = filteredItems.slice(startIndex, endIndex);

    // 转换数据格式
    const list: DoubanMovieDetail[] = paginatedItems.map((item: any) => {
      // 从abstract中提取年份
      const yearMatch = item.abstract?.match(/(\d{4})/);
      const year = yearMatch ? yearMatch[1] : '';

      return {
        id: item.id?.toString() || '',
        title: item.title || '',
        poster: item.cover_url || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: year,
      };
    });

    const result = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    return result;
  } catch (error) {
    console.error(`搜索演员 ${actorName} 失败:`, error);
    return {
      code: 500,
      message: `搜索演员 ${actorName} 失败: ${(error as Error).message}`,
      list: [],
    };
  }
}

export async function getExtractPlatformUrls(
  doubanId: string,
  episode?: string | null,
): Promise<PlatformUrl[]> {
  if (!doubanId) return [];
  try {
    const { platformLinks } = await fetchDoubanSubject(doubanId);
    return selectPlatformLinksFromCache(platformLinks, episode);
  } catch (error) {
    if (error instanceof Error && error.name === 'DoubanSubjectFetchError') {
      console.error(
        `Douban subject request failed: ${'status' in error ? (error.status ?? 'unknown') : 'unknown'}`,
        error.message,
      );
    } else if (error instanceof DOMException && error.name === 'AbortError') {
      console.error('Douban request timed out (10s):', doubanId);
    } else {
      console.error('Failed to extract platform URLs:', error);
    }
    throw error;
  }
}

/**
 * 通用的豆瓣数据获取函数
 * @param url 请求的URL
 * @returns Promise<T> 返回指定类型的数据
 */
export async function fetchDoubanData<T>(url: string): Promise<T> {
  // 添加超时控制
  const controller = new AbortController();
  try {
    const { fetchDoubanWithAntiScraping } =
      await import('@/lib/douban-challenge');
    let response = await fetchDoubanWithAntiScraping(url, {
      signal: controller.signal,
      timeoutMs: 10000,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
}

function parseDoubanDetails(html: string, id: string): DoubanResult {
  try {
    // 提取基本信息
    const titleMatch = html.match(
      /<h1[^>]*>[\s\S]*?<span[^>]*property="v:itemreviewed"[^>]*>([^<]+)<\/span>/,
    );
    const title = titleMatch ? titleMatch[1].trim() : '';

    // 提取海报
    const posterMatch = html.match(
      /<a[^>]*class="nbgnbg"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/,
    );
    const poster = posterMatch ? posterMatch[1] : '';

    // 提取评分
    const ratingMatch = html.match(
      /<strong[^>]*class="ll rating_num"[^>]*property="v:average">([^<]+)<\/strong>/,
    );
    const rate = ratingMatch ? ratingMatch[1] : '';

    // 提取年份
    const yearMatch = html.match(
      /<span[^>]*class="year">[(]([^)]+)[)]<\/span>/,
    );
    const year = yearMatch ? yearMatch[1] : '';

    // 根据真实HTML结构提取导演、编剧、主演
    let directors: string[] = [];
    let screenwriters: string[] = [];
    let cast: string[] = [];

    // 导演：<span class='pl'>导演</span>: <span class='attrs'><a href="..." rel="v:directedBy">刘家成</a></span>
    const directorMatch = html.match(
      /<span class=['"]pl['"]>导演<\/span>:\s*<span class=['"]attrs['"]>(.*?)<\/span>/,
    );
    if (directorMatch) {
      const directorLinks = directorMatch[1].match(/<a[^>]*>([^<]+)<\/a>/g);
      if (directorLinks) {
        directors = directorLinks
          .map((link) => {
            const nameMatch = link.match(/>([^<]+)</);
            return nameMatch ? nameMatch[1].trim() : '';
          })
          .filter(Boolean);
      }
    }

    // 编剧：<span class='pl'>编剧</span>: <span class='attrs'><a href="...">王贺</a></span>
    const writerMatch = html.match(
      /<span class=['"]pl['"]>编剧<\/span>:\s*<span class=['"]attrs['"]>(.*?)<\/span>/,
    );
    if (writerMatch) {
      const writerLinks = writerMatch[1].match(/<a[^>]*>([^<]+)<\/a>/g);
      if (writerLinks) {
        screenwriters = writerLinks
          .map((link) => {
            const nameMatch = link.match(/>([^<]+)</);
            return nameMatch ? nameMatch[1].trim() : '';
          })
          .filter(Boolean);
      }
    }

    // 主演：<span class='pl'>主演</span>: <span class='attrs'><a href="..." rel="v:starring">杨幂</a> / <a href="...">欧豪</a> / ...</span>
    const castMatch = html.match(
      /<span class=['"]pl['"]>主演<\/span>:\s*<span class=['"]attrs['"]>(.*?)<\/span>/,
    );
    if (castMatch) {
      const castLinks = castMatch[1].match(/<a[^>]*>([^<]+)<\/a>/g);
      if (castLinks) {
        cast = castLinks
          .map((link) => {
            const nameMatch = link.match(/>([^<]+)</);
            return nameMatch ? nameMatch[1].trim() : '';
          })
          .filter(Boolean);
      }
    }

    // 提取演员照片（从 celebrities 区域）- 增强版
    const celebrities: Array<DoubanCelebrity> = [];

    const celebritiesSection = html.match(
      /<div id="celebrities"[\s\S]*?<ul class="celebrities-list[^"]*">([\s\S]*?)<\/ul>/,
    );
    if (celebritiesSection) {
      const celebrityItems = celebritiesSection[1].match(
        /<li class="celebrity">[\s\S]*?<\/li>/g,
      );
      if (celebrityItems) {
        celebrityItems.forEach((item) => {
          // 提取演员ID和名字 - 支持 personage 和 celebrity 两种URL格式
          const linkMatch = item.match(
            /<a href="https:\/\/www\.douban\.com\/(personage|celebrity)\/(\d+)\/[^"]*"\s+title="([^"]+)"/,
          );

          // 🎯 三种方法提取头像 URL
          let avatarUrl = '';

          // 方法 1: CSS 背景图（最常见）
          const bgMatch = item.match(/background-image:\s*url\(([^)]+)\)/);
          if (bgMatch) {
            avatarUrl = bgMatch[1].replace(/^['"]|['"]$/g, ''); // 去掉引号
          }

          // 方法 2: IMG 标签 (fallback)
          if (!avatarUrl) {
            const imgMatch = item.match(/<img[^>]*src="([^"]+)"/);
            if (imgMatch) {
              avatarUrl = imgMatch[1];
            }
          }

          // 方法 3: data-src 属性
          if (!avatarUrl) {
            const dataSrcMatch = item.match(/data-src="([^"]+)"/);
            if (dataSrcMatch) {
              avatarUrl = dataSrcMatch[1];
            }
          }

          // 提取角色
          const roleMatch = item.match(
            /<span class="role"[^>]*>([^<]+)<\/span>/,
          );

          if (linkMatch && avatarUrl) {
            // 清理URL
            avatarUrl = avatarUrl.trim().replace(/^http:/, 'https:');

            // 🎨 高清图替换：/s/ → /l/, /m/ → /l/
            const largeUrl = avatarUrl
              .replace(/\/s\//, '/l/')
              .replace(/\/m\//, '/l/')
              .replace('/s_ratio/', '/l_ratio/')
              .replace('/m_ratio/', '/l_ratio/')
              .replace('/small/', '/large/')
              .replace('/medium/', '/large/');

            // 过滤掉默认头像
            const isDefaultAvatar =
              avatarUrl.includes('personage-default') ||
              avatarUrl.includes('celebrity-default') ||
              avatarUrl.includes('has_douban');

            if (!isDefaultAvatar) {
              celebrities.push({
                id: linkMatch[2], // 第二个捕获组是ID
                name: linkMatch[3].split(' ')[0], // 第三个捕获组是名字，只取中文名
                avatar: avatarUrl,
                role: roleMatch ? roleMatch[1].trim() : '',
                // 🎯 新增：返回三种尺寸的头像
                avatars: {
                  small: largeUrl
                    .replace('/l/', '/s/')
                    .replace('/l_ratio/', '/s_ratio/')
                    .replace('/large/', '/small/'),
                  medium: largeUrl
                    .replace('/l/', '/m/')
                    .replace('/l_ratio/', '/m_ratio/')
                    .replace('/large/', '/medium/'),
                  large: largeUrl,
                },
              });
            }
          }
        });
      }
    }

    // 提取推荐影片
    const recommendations: Array<DoubanRecommendation> = [];

    const recommendationsSection = html.match(
      /<div id="recommendations">[\s\S]*?<div class="recommendations-bd">([\s\S]*?)<\/div>/,
    );
    if (recommendationsSection) {
      const recommendItems =
        recommendationsSection[1].match(/<dl>[\s\S]*?<\/dl>/g);
      if (recommendItems) {
        recommendItems.forEach((item) => {
          // 提取影片ID
          const idMatch = item.match(/\/subject\/(\d+)\//);
          // 提取标题
          const titleMatch = item.match(/alt="([^"]+)"/);
          // 提取海报
          const posterMatch = item.match(/<img src="([^"]+)"/);
          // 提取评分
          const rateMatch = item.match(
            /<span class="subject-rate">([^<]+)<\/span>/,
          );

          if (idMatch && titleMatch && posterMatch) {
            recommendations.push({
              id: idMatch[1],
              title: titleMatch[1],
              poster: posterMatch[1],
              rate: rateMatch ? rateMatch[1] : '',
            });
          }
        });
      }
    }

    // 提取类型
    const genreMatches = html.match(
      /<span[^>]*property="v:genre">([^<]+)<\/span>/g,
    );
    const genres = genreMatches
      ? genreMatches
          .map((match) => {
            const result = match.match(
              /<span[^>]*property="v:genre">([^<]+)<\/span>/,
            );
            return result ? result[1] : '';
          })
          .filter(Boolean)
      : [];

    // 提取制片国家/地区
    const countryMatch = html.match(
      /<span[^>]*class="pl">制片国家\/地区:<\/span>([^<]+)/,
    );
    const countries = countryMatch
      ? countryMatch[1]
          .trim()
          .split('/')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

    // 提取语言
    const languageMatch = html.match(
      /<span[^>]*class="pl">语言:<\/span>([^<]+)/,
    );
    const languages = languageMatch
      ? languageMatch[1]
          .trim()
          .split('/')
          .map((l) => l.trim())
          .filter(Boolean)
      : [];

    // 提取首播/上映日期 - 根据真实HTML结构
    let first_aired = '';

    // 首播信息：<span class="pl">首播:</span> <span property="v:initialReleaseDate" content="2025-08-13(中国大陆)">2025-08-13(中国大陆)</span>
    const firstAiredMatch = html.match(
      /<span class="pl">首播:<\/span>\s*<span[^>]*property="v:initialReleaseDate"[^>]*content="([^"]*)"[^>]*>([^<]*)<\/span>/,
    );
    if (firstAiredMatch) {
      first_aired = firstAiredMatch[1]; // 使用content属性的值
    } else {
      // 如果没有首播，尝试上映日期 - 可能有多个日期，取第一个
      const releaseDateMatch = html.match(
        /<span class="pl">上映日期:<\/span>\s*<span[^>]*property="v:initialReleaseDate"[^>]*content="([^"]*)"[^>]*>([^<]*)<\/span>/,
      );
      if (releaseDateMatch) {
        first_aired = releaseDateMatch[1];
      }
    }

    // 提取集数（仅剧集有）
    const episodesMatch = html.match(
      /<span[^>]*class="pl">集数:<\/span>([^<]+)/,
    );
    const episodes = episodesMatch
      ? parseInt(episodesMatch[1].trim()) || undefined
      : undefined;

    // 提取时长 - 支持电影和剧集
    let episode_length: number | undefined;
    let movie_duration: number | undefined;

    // 先尝试提取剧集的单集片长
    const singleEpisodeDurationMatch = html.match(
      /<span[^>]*class="pl">单集片长:<\/span>([^<]+)/,
    );
    if (singleEpisodeDurationMatch) {
      episode_length =
        parseInt(singleEpisodeDurationMatch[1].trim()) || undefined;
    } else {
      // 如果没有单集片长，尝试提取电影的总片长
      const movieDurationMatch = html.match(
        /<span[^>]*class="pl">片长:<\/span>([^<]+)/,
      );
      if (movieDurationMatch) {
        movie_duration = parseInt(movieDurationMatch[1].trim()) || undefined;
      }
    }

    // 提取剧情简介 - 使用更宽松的匹配，支持HTML标签
    const summaryMatch =
      html.match(/<span[^>]*class="all hidden">([\s\S]*?)<\/span>/) ||
      html.match(/<span[^>]*property="v:summary"[^>]*>([\s\S]*?)<\/span>/);
    let plot_summary = '';
    if (summaryMatch) {
      // 移除HTML标签，保留文本内容
      plot_summary = summaryMatch[1]
        .replace(/<br\s*\/?>/gi, '\n') // 将<br>转换为换行
        .replace(/<[^>]+>/g, '') // 移除其他HTML标签
        .trim()
        .replace(/\n{3,}/g, '\n\n'); // 将多个换行合并为最多两个
    }

    // 🎬 提取剧照作为backdrop（横版高清图，比竖版海报更适合做背景）
    let scenePhoto: string | undefined;
    const photosSection = html.match(
      /<div[^>]*id="related-pic"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/,
    );
    if (photosSection) {
      // 查找第一张剧照图片URL
      const photoMatch = photosSection[1].match(
        /https:\/\/img[0-9]\.doubanio\.com\/view\/photo\/[a-z_]*\/public\/p[0-9]+\.jpg/,
      );
      if (photoMatch) {
        // 转换为高清版本（使用l而不是raw，避免重定向）
        scenePhoto = photoMatch[0]
          .replace(/^http:/, 'https:')
          .replace('/view/photo/s/', '/view/photo/l/')
          .replace('/view/photo/m/', '/view/photo/l/')
          .replace('/view/photo/sqxs/', '/view/photo/l/');
      }
    }

    return {
      code: 200,
      message: '获取成功',
      list: [
        {
          id,
          title,
          poster: poster.replace(/^http:/, 'https:'),
          rate,
          year,
          directors,
          screenwriters,
          cast,
          genres,
          countries,
          languages,
          episodes,
          episode_length,
          movie_duration,
          first_aired,
          plot_summary,
          celebrities,
          recommendations,
          // 🎯 新增：将 celebrities 中的演员单独提取为 actors 字段
          actors: celebrities.filter((c) => !c.role.includes('导演')),
          // 🎬 剧照作为backdrop（横版高清图）
          backdrop: scenePhoto,
          // 🎬 预告片URL（由移动端API填充）
          trailerUrl: undefined,
        },
      ],
    };
  } catch (error) {
    throw new DoubanError(
      `解析豆瓣详情页面失败: ${error instanceof Error ? error.message : '未知错误'}`,
      'PARSE_ERROR',
    );
  }
}
