'use server';

import { assertCompleteReleaseCalendar } from './release-calendar-validation.ts';
import type { ReleaseCalendarItem } from './types.ts';
import { getRandomUserAgentWithInfo, getSecChUaHeaders } from './user-agent.ts';

const baseUrl = 'https://g.manmankan.com/dy2013';
const MAX_SCRAPE_RETRIES = 1;
const RETRY_DELAYS = [1500];
const UPSTREAM_TIMEOUT_MS = 12_000;

function createHttpStatusError(response: Response, url: string): Error {
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  const edge = [response.headers.get('server'), response.headers.get('via')]
    .filter(Boolean)
    .join('; ');
  const edgeDetails = edge ? ` [${edge}]` : '';
  return new Error(
    `HTTP ${response.status}${statusText}: ${url}${edgeDetails}`,
  );
}

function assertParsedReleases(
  items: ReleaseCalendarItem[],
  label: string,
  url: string,
): void {
  if (items.length === 0) {
    throw new Error(`${label}未解析到可用数据: ${url}`);
  }
}

/**
 * 生成唯一ID
 */
function generateId(title: string): string {
  return title.replace(/[^\w\u4e00-\u9fa5]/g, '').substring(0, 20);
}

/**
 * 解析电影HTML页面
 */
function parseMovieHTML(html: string): ReleaseCalendarItem[] {
  const items: ReleaseCalendarItem[] = [];
  const now = Date.now();

  try {
    // 包含所有电影条目，包括隐藏的（dis_none）条目
    const itemBlocks = html.split(/<dl class="(?:twlist-block|dis_none)">/);

    for (let i = 1; i < itemBlocks.length; i++) {
      const block = itemBlocks[i];

      // 提取标题 - 从dd-d1 div中
      const titleMatch =
        /<div class="dd-d1"><a[^>]*title="[^"]*">([^<]+)<\/a><\/div>/.exec(
          block,
        );

      // 提取导演
      const directorMatch = /<div>导演：([^<]*)<\/div>/.exec(block);

      // 提取地区 - 需要处理链接
      const regionMatch = /<div>地区：<a[^>]*>([^<]*)<\/a><\/div>/.exec(block);

      // 提取类型 - 需要处理多个链接
      const genreMatch = /<div>类型：(.*?)<\/div>/.exec(block);

      // 提取上映时间
      const dateMatch = /<div>上映时间：(\d{4}\/\d{2}\/\d{2})<\/div>/.exec(
        block,
      );

      // 提取主演 - 需要处理多个链接
      const actorsMatch = /<div class="dd-d2">主演：(.*?)<\/div>/.exec(block);

      // 提取海报图片 - 优先从 data-original 获取（懒加载），否则从 src
      const dataOriginalMatch = /<img[^>]*data-original=["']([^"']+)["']/.exec(
        block,
      );
      const srcMatch = /<img[^>]*src=["']([^"']+)["']/.exec(block);

      let coverUrl: string | undefined;
      if (dataOriginalMatch) {
        coverUrl = dataOriginalMatch[1].trim();
      } else if (srcMatch) {
        coverUrl = srcMatch[1].trim();
      }

      // 处理海报URL：添加协议前缀
      if (coverUrl && coverUrl.startsWith('//')) {
        coverUrl = 'https:' + coverUrl;
      }
      // 过滤掉占位符图片
      if (coverUrl && coverUrl.includes('loadimg.gif')) {
        coverUrl = undefined;
      }

      if (titleMatch && dateMatch) {
        const title = titleMatch[1].trim();
        const dateStr = dateMatch[1].replace(/\//g, '-'); // 转换日期格式

        // 只保留今天及以后的数据
        const today = new Date().toISOString().split('T')[0];
        if (dateStr < today) {
          continue;
        }

        const director = directorMatch ? directorMatch[1].trim() : '未知';
        const region = regionMatch ? regionMatch[1].trim() : '未知';

        // 清理类型字段，移除HTML标签并保留斜杠分隔
        let genre = genreMatch ? genreMatch[1].trim() : '未知';
        genre = genre
          .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();

        // 清理主演字段，移除HTML标签并保留斜杠分隔
        let actors = actorsMatch ? actorsMatch[1].trim() : '未知';
        actors = actors
          .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();

        if (title && !title.includes('暂无')) {
          const item: ReleaseCalendarItem = {
            id: `movie_${dateStr}_${generateId(title)}`,
            title: title,
            type: 'movie',
            director: director,
            actors: actors,
            region: region,
            genre: genre,
            releaseDate: dateStr,
            cover: coverUrl,
            source: 'manmankan',
            createdAt: now,
            updatedAt: now,
          };

          items.push(item);
        }
      }
    }
  } catch (error) {
    console.error('解析电影HTML失败:', error);
  }

  return items;
}

/**
 * 解析电视剧HTML页面
 */
function parseTVHTML(html: string): ReleaseCalendarItem[] {
  const items: ReleaseCalendarItem[] = [];
  const now = Date.now();

  try {
    // 包含所有电视剧条目，包括隐藏的（dis_none）条目
    const itemBlocks = html.split(/<dl class="(?:twlist-block|dis_none)">/);

    for (let i = 1; i < itemBlocks.length; i++) {
      const block = itemBlocks[i];

      // 提取标题 - 从dd-d1 div中
      const titleMatch =
        /<div class="dd-d1"><a[^>]*title="[^"]*">([^<]+)<\/a><\/div>/.exec(
          block,
        );

      // 提取导演
      const directorMatch = /<div>导演：([^<]*)<\/div>/.exec(block);

      // 提取地区 - 需要处理链接
      const regionMatch = /<div>地区：<a[^>]*>([^<]*)<\/a><\/div>/.exec(block);

      // 提取类型 - 需要处理多个链接
      const genreMatch = /<div>类型：(.*?)<\/div>/.exec(block);

      // 提取上映时间
      const dateMatch = /<div>上映时间：(\d{4}\/\d{2}\/\d{2})<\/div>/.exec(
        block,
      );

      // 提取主演 - 需要处理多个链接
      const actorsMatch = /<div class="dd-d2">主演：(.*?)<\/div>/.exec(block);

      // 提取海报图片 - 优先从 data-original 获取（懒加载），否则从 src
      const dataOriginalMatch = /<img[^>]*data-original=["']([^"']+)["']/.exec(
        block,
      );
      const srcMatch = /<img[^>]*src=["']([^"']+)["']/.exec(block);

      let coverUrl: string | undefined;
      if (dataOriginalMatch) {
        coverUrl = dataOriginalMatch[1].trim();
      } else if (srcMatch) {
        coverUrl = srcMatch[1].trim();
      }

      // 处理海报URL：添加协议前缀
      if (coverUrl && coverUrl.startsWith('//')) {
        coverUrl = 'https:' + coverUrl;
      }
      // 过滤掉占位符图片
      if (coverUrl && coverUrl.includes('loadimg.gif')) {
        coverUrl = undefined;
      }

      if (titleMatch && dateMatch) {
        const title = titleMatch[1].trim();
        const dateStr = dateMatch[1].replace(/\//g, '-'); // 转换日期格式

        // 只保留今天及以后的数据
        const today = new Date().toISOString().split('T')[0];
        if (dateStr < today) {
          continue;
        }

        const director = directorMatch ? directorMatch[1].trim() : '未知';
        const region = regionMatch ? regionMatch[1].trim() : '未知';

        // 清理类型字段，移除HTML标签并保留斜杠分隔
        let genre = genreMatch ? genreMatch[1].trim() : '未知';
        genre = genre
          .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();

        // 清理主演字段，移除HTML标签并保留斜杠分隔
        let actors = actorsMatch ? actorsMatch[1].trim() : '未知';
        actors = actors
          .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();

        if (title && !title.includes('暂无')) {
          const item: ReleaseCalendarItem = {
            id: `tv_${dateStr}_${generateId(title)}`,
            title: title,
            type: 'tv',
            director: director,
            actors: actors,
            region: region,
            genre: genre,
            releaseDate: dateStr,
            cover: coverUrl,
            source: 'manmankan',
            createdAt: now,
            updatedAt: now,
          };

          items.push(item);
        }
      }
    }
  } catch (error) {
    console.error('解析电视剧HTML失败:', error);
  }

  return items;
}

/**
 * 抓取电影发布时间表（带重试机制）
 */
export async function scrapeMovieReleases(
  retryCount = 0,
): Promise<ReleaseCalendarItem[]> {
  try {
    const url = `${baseUrl}/dianying/shijianbiao/`;

    // 获取随机浏览器指纹
    const { ua, browser, platform } = getRandomUserAgentWithInfo();
    const secChHeaders = getSecChUaHeaders(browser, platform);

    // 🎯 2025 最佳实践：完整的请求头
    const response = await fetch(url, {
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'max-age=0',
        DNT: '1',
        ...secChHeaders, // Chrome/Edge 的 Sec-CH-UA 头部
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': ua,
        Referer: baseUrl + '/',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) throw createHttpStatusError(response, url);

    const html = await response.text();
    const items = parseMovieHTML(html);
    assertParsedReleases(items, '电影时间表', url);

    console.log(`✅ 电影数据抓取成功: ${items.length} 部`);
    return items;
  } catch (error) {
    console.error(
      `抓取电影数据失败 (重试 ${retryCount}/${MAX_SCRAPE_RETRIES}):`,
      error,
    );

    // 重试机制
    if (retryCount < MAX_SCRAPE_RETRIES) {
      console.warn(`等待 ${RETRY_DELAYS[retryCount]}ms 后重试...`);
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS[retryCount]),
      );
      return scrapeMovieReleases(retryCount + 1);
    }

    console.error('电影数据抓取失败，已达到最大重试次数');
    throw error;
  }
}

/**
 * 抓取电视剧发布时间表（带重试机制）
 */
export async function scrapeTVReleases(
  retryCount = 0,
): Promise<ReleaseCalendarItem[]> {
  try {
    const url = `${baseUrl}/dianshiju/shijianbiao/`;

    // 获取随机浏览器指纹
    const { ua, browser, platform } = getRandomUserAgentWithInfo();
    const secChHeaders = getSecChUaHeaders(browser, platform);

    // 🎯 2025 最佳实践：完整的请求头
    const response = await fetch(url, {
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'max-age=0',
        DNT: '1',
        ...secChHeaders, // Chrome/Edge 的 Sec-CH-UA 头部
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': ua,
        Referer: baseUrl + '/',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) throw createHttpStatusError(response, url);

    const html = await response.text();
    const items = parseTVHTML(html);
    assertParsedReleases(items, '电视剧时间表', url);

    console.log(`✅ 电视剧数据抓取成功: ${items.length} 部`);
    return items;
  } catch (error) {
    console.error(
      `抓取电视剧数据失败 (重试 ${retryCount}/${MAX_SCRAPE_RETRIES}):`,
      error,
    );

    // 重试机制
    if (retryCount < MAX_SCRAPE_RETRIES) {
      console.warn(`等待 ${RETRY_DELAYS[retryCount]}ms 后重试...`);
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS[retryCount]),
      );
      return scrapeTVReleases(retryCount + 1);
    }

    console.error('电视剧数据抓取失败，已达到最大重试次数');
    throw error;
  }
}

/**
 * 解析首页上映时间表HTML（包含2026年1月数据）
 */
function parseHomepageHTML(
  html: string,
  type: 'movie' | 'tv',
): ReleaseCalendarItem[] {
  const items: ReleaseCalendarItem[] = [];
  const now = Date.now();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-12

  try {
    // 首页使用 <div class="sjbul-d"> 结构
    const itemBlocks = html.split(/<div class="sjbul-d(?:\s+sjbul-d\d+)?">/);

    for (let i = 1; i < itemBlocks.length; i++) {
      const block = itemBlocks[i];

      // 提取标题
      const titleMatch =
        /<a href="[^"]*" title="([^"]+)" target="_blank" class="ddp1">/.exec(
          block,
        );

      // 提取详情页链接（用于提取ID）
      const linkMatch =
        /<a title="[^"]+" target="_blank" href="\/dy2013\/(\d{6})\/(\d+)\.shtml">/.exec(
          block,
        );

      // 提取上映日期（只有月日，例如 "01月01日"）
      const dateMatch =
        /<p class="ddp2">上映：<span>(\d{2})月(\d{2})日<\/span><\/p>/.exec(
          block,
        );

      // 提取类型
      const genreMatches = block.match(
        /<a href="\/dy2013\/dian(?:ying|shiju)\/\w+\/" target="_blank" title="[^"]+">([^<]+)<\/a>/g,
      );
      let genre = '未知';
      if (genreMatches && genreMatches.length > 0) {
        genre = genreMatches
          .map((m) => {
            const match = />([^<]+)<\/a>/.exec(m);
            return match ? match[1].replace(/电影|电视剧/g, '') : '';
          })
          .filter((g) => g)
          .join('/');
      }

      // 提取主演
      const actorsMatch = /<p class="ddp4">主演：(.*?)<\/p>/.exec(block);
      let actors = '未知';
      if (actorsMatch) {
        const actorMatches = actorsMatch[1].match(/<a[^>]*>([^<]+)<\/a>/g);
        if (actorMatches) {
          actors = actorMatches
            .map((m) => {
              const match = />([^<]+)<\/a>/.exec(m);
              return match ? match[1] : '';
            })
            .filter((a) => a)
            .join('/');
        }
      }

      // 提取海报图片
      const imgMatch =
        /data-src="([^"]+)"/.exec(block) || /src="([^"]+)"/.exec(block);
      let coverUrl: string | undefined;
      if (
        imgMatch &&
        imgMatch[1] &&
        !imgMatch[1].includes('fbg.png') &&
        !imgMatch[1].includes('loadimg.gif')
      ) {
        coverUrl = imgMatch[1].trim();
        if (coverUrl.startsWith('//')) {
          coverUrl = 'https:' + coverUrl;
        }
      }

      if (titleMatch && dateMatch && linkMatch) {
        const title = titleMatch[1].trim();
        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);

        // 推断年份：如果月份小于当前月份，说明是下一年
        let year = currentYear;
        if (
          month < currentMonth ||
          (month === currentMonth && day < new Date().getDate())
        ) {
          year = currentYear + 1;
        }

        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // 只保留今天及以后的数据
        const today = new Date().toISOString().split('T')[0];
        if (dateStr < today) {
          continue;
        }

        const itemId = linkMatch[2];

        if (title && !title.includes('暂无')) {
          const item: ReleaseCalendarItem = {
            id: `${type}_homepage_${dateStr}_${generateId(title)}_${itemId}`,
            title: title,
            type: type,
            director: '未知', // 首页没有导演信息
            actors: actors,
            region: '未知', // 首页没有地区信息
            genre: genre,
            releaseDate: dateStr,
            cover: coverUrl,
            source: 'manmankan',
            createdAt: now,
            updatedAt: now,
          };

          items.push(item);
        }
      }
    }

    // 🎯 新增：解析 <dl> 结构（首页顶部列表，包含1月23日等数据）
    const dlBlocks = html.split(/<dl><dt>/);
    for (let i = 1; i < dlBlocks.length; i++) {
      const block = '<dl><dt>' + dlBlocks[i]; // 恢复开头标签

      // 提取标题 - 两种可能的位置
      let titleMatch =
        /<a href="[^"]*" title="([^"]+)" target="_blank" class="ddp1">/.exec(
          block,
        );
      if (!titleMatch) {
        titleMatch = /<a title="([^"]+)" target="_blank" href="[^"]*">/.exec(
          block,
        );
      }

      // 提取详情页链接（用于提取ID）
      const linkMatch =
        /<a title="[^"]+" target="_blank" href="\/dy2013\/(\d{6})\/(\d+)\.shtml">/.exec(
          block,
        );

      // 提取上映日期（只有月日，例如 "01月23日"）
      const dateMatch =
        /<p class="ddp2">上映：<span>(\d{2})月(\d{2})日<\/span><\/p>/.exec(
          block,
        );

      // 提取类型
      const genreMatches = block.match(
        /<a href="\/dy2013\/dian(?:ying|shiju)\/\w+\/" target="_blank" title="[^"]+">([^<]+)<\/a>/g,
      );
      let genre = '未知';
      if (genreMatches && genreMatches.length > 0) {
        genre = genreMatches
          .map((m) => {
            const match = />([^<]+)<\/a>/.exec(m);
            return match ? match[1].replace(/电影|电视剧/g, '') : '';
          })
          .filter((g) => g)
          .join('/');
      }

      // 提取主演
      const actorsMatch = /<p class="ddp4">主演：(.*?)<\/p>/.exec(block);
      let actors = '未知';
      if (actorsMatch) {
        const actorMatches = actorsMatch[1].match(/<a[^>]*>([^<]+)<\/a>/g);
        if (actorMatches) {
          actors = actorMatches
            .map((m) => {
              const match = />([^<]+)<\/a>/.exec(m);
              return match ? match[1] : '';
            })
            .filter((a) => a)
            .join('/');
        }
      }

      // 提取海报图片
      const imgMatch =
        /data-src="([^"]+)"/.exec(block) || /src="([^"]+)"/.exec(block);
      let coverUrl: string | undefined;
      if (
        imgMatch &&
        imgMatch[1] &&
        !imgMatch[1].includes('fbg.png') &&
        !imgMatch[1].includes('loadimg.gif')
      ) {
        coverUrl = imgMatch[1].trim();
        if (coverUrl.startsWith('//')) {
          coverUrl = 'https:' + coverUrl;
        }
      }

      if (titleMatch && dateMatch && linkMatch) {
        const title = titleMatch[1].trim();
        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);

        // 推断年份：如果月份小于当前月份，说明是下一年
        let year = currentYear;
        if (
          month < currentMonth ||
          (month === currentMonth && day < new Date().getDate())
        ) {
          year = currentYear + 1;
        }

        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // 只保留今天及以后的数据
        const today = new Date().toISOString().split('T')[0];
        if (dateStr < today) {
          continue;
        }

        const itemId = linkMatch[2];

        if (title && !title.includes('暂无')) {
          const item: ReleaseCalendarItem = {
            id: `${type}_homepage_dl_${dateStr}_${generateId(title)}_${itemId}`,
            title: title,
            type: type,
            director: '未知', // 首页没有导演信息
            actors: actors,
            region: '未知', // 首页没有地区信息
            genre: genre,
            releaseDate: dateStr,
            cover: coverUrl,
            source: 'manmankan',
            createdAt: now,
            updatedAt: now,
          };

          items.push(item);
        }
      }
    }
  } catch (error) {
    console.error(
      `解析${type === 'movie' ? '电影' : '电视剧'}首页HTML失败:`,
      error,
    );
  }

  return items;
}

/**
 * 抓取电影首页（包含2026年1月数据）
 */
const HOMEPAGE_DOMAINS = [
  'https://www.manmankan.com',
  'https://g.manmankan.com',
];

async function fetchHomepageItemsWithFallback(
  path: string,
  type: 'movie' | 'tv',
  headers: Record<string, string>,
): Promise<{ items: ReleaseCalendarItem[]; url: string }> {
  let lastError: unknown;

  for (const domain of HOMEPAGE_DOMAINS) {
    const url = `${domain}${path}`;
    try {
      const response = await fetch(url, {
        headers: {
          ...headers,
          Referer: `${domain}/`,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (!response.ok) throw createHttpStatusError(response, url);

      const html = await response.text();
      const items = parseHomepageHTML(html, type);
      assertParsedReleases(
        items,
        type === 'movie' ? '电影首页' : '电视剧首页',
        url,
      );
      return { items, url };
    } catch (error) {
      lastError = error;
      console.warn(`Homepage source unavailable for ${url}:`, error);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Homepage fetch failed');
}

export async function scrapeMovieHomepage(
  retryCount = 0,
): Promise<ReleaseCalendarItem[]> {
  try {
    const path = '/dy2013/dianying/';

    const { ua, browser, platform } = getRandomUserAgentWithInfo();
    const secChHeaders = getSecChUaHeaders(browser, platform);

    const { items, url } = await fetchHomepageItemsWithFallback(path, 'movie', {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'max-age=0',
      DNT: '1',
      ...secChHeaders,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': ua,
    });

    console.log(`✅ 电影首页数据抓取成功 (${url}): ${items.length} 部`);
    return items;
  } catch (error) {
    console.error(
      `抓取电影首页数据失败 (重试 ${retryCount}/${MAX_SCRAPE_RETRIES}):`,
      error,
    );

    if (retryCount < MAX_SCRAPE_RETRIES) {
      console.warn(`等待 ${RETRY_DELAYS[retryCount]}ms 后重试...`);
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS[retryCount]),
      );
      return scrapeMovieHomepage(retryCount + 1);
    }

    console.error('电影首页数据抓取失败，已达到最大重试次数');
    throw error;
  }
}

/**
 * 抓取电视剧首页（包含2026年1月数据）
 */
export async function scrapeTVHomepage(
  retryCount = 0,
): Promise<ReleaseCalendarItem[]> {
  try {
    const path = '/dy2013/dianshiju/';

    const { ua, browser, platform } = getRandomUserAgentWithInfo();
    const secChHeaders = getSecChUaHeaders(browser, platform);

    const { items, url } = await fetchHomepageItemsWithFallback(path, 'tv', {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'max-age=0',
      DNT: '1',
      ...secChHeaders,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': ua,
    });

    console.log(`✅ 电视剧首页数据抓取成功 (${url}): ${items.length} 部`);
    return items;
  } catch (error) {
    console.error(
      `抓取电视剧首页数据失败 (重试 ${retryCount}/${MAX_SCRAPE_RETRIES}):`,
      error,
    );

    if (retryCount < MAX_SCRAPE_RETRIES) {
      console.warn(`等待 ${RETRY_DELAYS[retryCount]}ms 后重试...`);
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS[retryCount]),
      );
      return scrapeTVHomepage(retryCount + 1);
    }

    console.error('电视剧首页数据抓取失败，已达到最大重试次数');
    throw error;
  }
}

/**
 * 抓取所有数据。时间表两路使用受控的双并发；长期返回空数据的首页
 * 来源只在对应时间表不可用时作为降级，不再拖慢每次正常刷新。
 */
export async function scrapeAllReleases(): Promise<ReleaseCalendarItem[]> {
  try {
    console.log('📅 开始抓取发布日历数据...');

    const [movieResult, tvResult] = await Promise.allSettled([
      scrapeMovieReleases(),
      scrapeTVReleases(),
    ]);
    let movies = movieResult.status === 'fulfilled' ? movieResult.value : [];
    let tvShows = tvResult.status === 'fulfilled' ? tvResult.value : [];

    if (movieResult.status === 'rejected') {
      console.warn('电影时间表不可用，尝试首页降级源:', movieResult.reason);
    }
    if (tvResult.status === 'rejected') {
      console.warn('电视剧时间表不可用，尝试首页降级源:', tvResult.reason);
    }

    const fallbacks: Promise<void>[] = [];
    if (movies.length === 0) {
      fallbacks.push(
        scrapeMovieHomepage().then((items) => {
          movies = items;
        }),
      );
    }
    if (tvShows.length === 0) {
      fallbacks.push(
        scrapeTVHomepage().then((items) => {
          tvShows = items;
        }),
      );
    }
    if (fallbacks.length > 0) {
      await Promise.allSettled(fallbacks);
    }

    // 合并所有数据，去重（按title和releaseDate去重）
    const allItems = [...movies, ...tvShows];
    assertCompleteReleaseCalendar(allItems, '发布日历上游返回数据');
    const uniqueItems = allItems.filter(
      (item, index, self) =>
        index ===
        self.findIndex(
          (t) => t.title === item.title && t.releaseDate === item.releaseDate,
        ),
    );

    console.log(
      `🎉 总共抓取到 ${allItems.length} 条发布数据（去重后 ${uniqueItems.length} 条）`,
    );

    return uniqueItems;
  } catch (error) {
    console.error('❌ 抓取发布日历数据失败:', error);
    throw error;
  }
}

/**
 * 获取发布日历数据（带缓存）
 */
type ReleaseCalendarQueryOptions = {
  type?: 'movie' | 'tv';
  region?: string;
  genre?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

type ReleaseCalendarFilters = {
  types: Array<{ value: 'movie' | 'tv'; label: string; count: number }>;
  regions: Array<{ value: string; label: string; count: number }>;
  genres: Array<{ value: string; label: string; count: number }>;
};

function buildReleaseCalendarFilters(
  allItems: ReleaseCalendarItem[],
): ReleaseCalendarFilters {
  // 统计类型
  const typeCount = { movie: 0, tv: 0 };
  allItems.forEach((item) => typeCount[item.type]++);

  // 统计地区
  const regionCount: Record<string, number> = {};
  allItems.forEach((item) => {
    const region = item.region || '未知';
    regionCount[region] = (regionCount[region] || 0) + 1;
  });

  // 统计类型/标签
  const genreCount: Record<string, number> = {};
  allItems.forEach((item) => {
    const genre = item.genre || '未知';
    genreCount[genre] = (genreCount[genre] || 0) + 1;
  });

  return {
    types: [
      { value: 'movie', label: '电影', count: typeCount.movie },
      { value: 'tv', label: '电视剧', count: typeCount.tv },
    ],
    regions: Object.entries(regionCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([region, count]) => ({ value: region, label: region, count })),
    genres: Object.entries(genreCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([genre, count]) => ({ value: genre, label: genre, count })),
  };
}

function filterReleaseCalendarItems(
  allItems: ReleaseCalendarItem[],
  options: ReleaseCalendarQueryOptions,
): {
  items: ReleaseCalendarItem[];
  total: number;
  hasMore: boolean;
} {
  // 应用过滤条件
  let filteredItems = allItems;

  if (options.type) {
    filteredItems = filteredItems.filter((item) => item.type === options.type);
  }

  if (options.region && options.region !== '全部') {
    filteredItems = filteredItems.filter((item) =>
      item.region.includes(options.region!),
    );
  }

  if (options.genre && options.genre !== '全部') {
    filteredItems = filteredItems.filter((item) =>
      item.genre.includes(options.genre!),
    );
  }

  if (options.dateFrom) {
    filteredItems = filteredItems.filter(
      (item) => item.releaseDate >= options.dateFrom!,
    );
  }

  if (options.dateTo) {
    filteredItems = filteredItems.filter(
      (item) => item.releaseDate <= options.dateTo!,
    );
  }

  // 按发布日期排序
  filteredItems.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  const total = filteredItems.length;
  const limit = options.limit;
  const offset = options.offset || 0;

  // 如果没有指定limit，返回所有数据
  const items = limit
    ? filteredItems.slice(offset, offset + limit)
    : filteredItems.slice(offset);
  const hasMore = limit ? offset + limit < total : false;

  return { items, total, hasMore };
}

/**
 * 获取发布日历数据（带缓存）
 */
export async function getReleaseCalendar(
  options: ReleaseCalendarQueryOptions = {},
): Promise<{
  items: ReleaseCalendarItem[];
  total: number;
  hasMore: boolean;
}> {
  try {
    const allItems = await scrapeAllReleases();
    return filterReleaseCalendarItems(allItems, options);
  } catch (error) {
    console.error('获取发布日历失败:', error);
    return { items: [], total: 0, hasMore: false };
  }
}

/**
 * 获取过滤器选项
 */
export async function getFilters(): Promise<ReleaseCalendarFilters> {
  try {
    const allItems = await scrapeAllReleases();
    return buildReleaseCalendarFilters(allItems);
  } catch (error) {
    console.error('获取过滤器失败:', error);
    return { types: [], regions: [], genres: [] };
  }
}

/**
 * 一次抓取构建数据和过滤器，避免重复请求
 */
export async function getReleaseCalendarWithFilters(
  options: ReleaseCalendarQueryOptions = {},
): Promise<{
  items: ReleaseCalendarItem[];
  total: number;
  hasMore: boolean;
  filters: ReleaseCalendarFilters;
  allCalendar: {
    items: ReleaseCalendarItem[];
    total: number;
    hasMore: boolean;
  };
}> {
  try {
    const allItems = await scrapeAllReleases();
    const calendar = filterReleaseCalendarItems(allItems, options);
    const filters = buildReleaseCalendarFilters(allItems);
    const allCalendar = filterReleaseCalendarItems(allItems, {});
    return { ...calendar, filters, allCalendar };
  } catch (error) {
    console.error('获取发布日历失败:', error);
    throw error;
  }
}
