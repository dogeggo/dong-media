import {
  CACHE_POLICIES,
  cacheService,
  hashCacheValue,
} from '@/lib/cache-system';
import { API_CONFIG, ApiSite, getShowAdultContent } from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';
import { yellowWords } from '@/lib/yellow';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

/**
 * 通用的带缓存搜索函数
 */
async function searchWithCache(
  apiSite: ApiSite,
  page: number,
  url: string,
  scope: string,
  timeoutMs = 8000,
): Promise<{ results: SearchResult[]; pageCount?: number }> {
  try {
    return await cacheService.getOrLoad(
      CACHE_POLICIES.SEARCH_RESULTS,
      { source: apiSite.key, page, request: hashCacheValue(url) },
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            headers: API_CONFIG.search.headers,
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Search upstream returned ${response.status}`);
          }

          const data = await response.json();
          if (!data?.list || !Array.isArray(data.list)) {
            return { results: [] };
          }

          const results: SearchResult[] = [];
          data.list.forEach((item: ApiSearchItem) => {
            let episodes: string[] = [];
            let titles: string[] = [];
            if (item.vod_play_url) {
              const playSources = item.vod_play_url.split('$$$');
              playSources.forEach((playSource: string) => {
                const matchEpisodes: string[] = [];
                const matchTitles: string[] = [];
                playSource.split('#').forEach((titleAndUrl: string) => {
                  const episode = titleAndUrl.split('$');
                  if (episode.length === 2 && episode[1].endsWith('.m3u8')) {
                    matchTitles.push(episode[0]);
                    matchEpisodes.push(episode[1]);
                  }
                });
                if (matchEpisodes.length > episodes.length) {
                  episodes = matchEpisodes;
                  titles = matchTitles;
                }
              });
            }
            if (episodes.length === 0) return;
            results.push({
              id: item.vod_id.toString(),
              title: item.vod_name.trim().replace(/\s+/g, ' '),
              poster: item.vod_pic?.trim() || '',
              episodes,
              episodes_titles: titles,
              source: apiSite.key,
              source_name: apiSite.name,
              class: item.vod_class,
              year: item.vod_year
                ? item.vod_year.match(/\d{4}/)?.[0] || ''
                : 'unknown',
              desc: cleanHtmlTags(item.vod_content || ''),
              type_name: item.type_name,
              douban_id: item.vod_douban_id,
              remarks: item.vod_remarks,
            });
          });
          const pageCount = page === 1 ? data.pagecount || 1 : undefined;
          return { results, pageCount };
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        scope,
        isNegative: (value) => value.results.length === 0,
      },
    );
  } catch {
    return { results: [] };
  }
}

export async function searchFromApi(
  apiSite: ApiSite,
  searchVariants: string[],
  maxPage: number,
  username?: string,
): Promise<SearchResult[]> {
  try {
    const apiBaseUrl = apiSite.api;
    let searchResults: SearchResult[] = [];
    const additionalPagePromises: Promise<SearchResult[]>[] = [];
    for (const query of searchVariants) {
      const encodedQuery = encodeURIComponent(query);
      const page1Url =
        apiBaseUrl +
        API_CONFIG.search.pagePath
          .replace('query', encodedQuery)
          .replace('page', '1');
      const cacheScope = username || 'system';
      const firstPageResult = await searchWithCache(
        apiSite,
        1,
        page1Url,
        cacheScope,
        8000,
      );
      if (firstPageResult.results.length > 0) {
        searchResults.push(...firstPageResult.results);
      }
      const pageCount = firstPageResult.pageCount ?? 1;
      const totalPages = Math.min(maxPage, Math.max(1, pageCount));
      for (let page = 2; page <= totalPages; page++) {
        const apiUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('query', encodedQuery)
            .replace('page', page.toString());
        const pagePromise = (async () => {
          const pageResult = await searchWithCache(
            apiSite,
            page,
            apiUrl,
            cacheScope,
            8000,
          );
          return pageResult.results;
        })();
        additionalPagePromises.push(pagePromise);
      }
    }
    const additionalResults = await Promise.all(additionalPagePromises);
    additionalResults.forEach((pageResults) => {
      if (pageResults.length > 0) {
        searchResults.push(...pageResults);
      }
    });
    const seenIds = new Set<string>();
    let finalResults: SearchResult[] = [];
    // 去重添加结果
    searchResults.forEach((result) => {
      const uniqueKey = `${result.source}_${result.id}`;
      if (!seenIds.has(uniqueKey)) {
        seenIds.add(uniqueKey);
        finalResults.push(result);
      }
    });
    if (username) {
      const showAdultContent = await getShowAdultContent(username);
      if (!showAdultContent) {
        finalResults = finalResults.filter((result) => {
          const typeName = result.type_name || '';
          const title = result.title || '';
          return !yellowWords.some(
            (word: string) => typeName.includes(word) || title.includes(word),
          );
        });
      }
    }
    return finalResults;
  } catch (_error) {
    return [];
  }
}

// 匹配 m3u8 链接的正则
const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
  if (!response.ok) {
    throw new Error(`详情请求失败: ${response.status}`);
  }

  const data = await response.json();
  if (
    !data ||
    !data.list ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    throw new Error('获取到的详情内容无效');
  }
  const videoDetail = data.list[0];
  let episodes: string[] = [];
  let titles: string[] = [];

  // 处理播放源拆分
  if (videoDetail.vod_play_url) {
    // 先用 $$$ 分割
    const vod_play_url_array = videoDetail.vod_play_url.split('$$$');
    // 分集之间#分割，标题和播放链接 $ 分割
    vod_play_url_array.forEach((url: string) => {
      const matchEpisodes: string[] = [];
      const matchTitles: string[] = [];
      const title_url_array = url.split('#');
      title_url_array.forEach((title_url: string) => {
        const episode_title_url = title_url.split('$');
        if (
          episode_title_url.length === 2 &&
          episode_title_url[1].endsWith('.m3u8')
        ) {
          matchTitles.push(episode_title_url[0]);
          matchEpisodes.push(episode_title_url[1]);
        }
      });
      if (matchEpisodes.length > episodes.length) {
        episodes = matchEpisodes;
        titles = matchTitles;
      }
    });
  }

  // 如果播放源为空，则尝试从内容中解析 m3u8
  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
    episodes = matches.map((link: string) => link.replace(/^\$/, ''));
  }

  return {
    id: id.toString(),
    title: videoDetail.vod_name,
    poster: videoDetail.vod_pic?.trim() || '', // 确保poster为有效字符串，过滤空白
    episodes,
    episodes_titles: titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: videoDetail.vod_class,
    year: videoDetail.vod_year
      ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(videoDetail.vod_content),
    type_name: videoDetail.type_name,
    douban_id: videoDetail.vod_douban_id,
    remarks: videoDetail.vod_remarks, // 传递备注信息（如"已完结"等）
  };
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite,
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  if (!response.ok) {
    throw new Error(`详情页请求失败: ${response.status}`);
  }

  const html = await response.text();
  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  // 去重并清理链接前缀
  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1); // 去掉开头的 $
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  // 根据 matches 数量生成剧集标题
  const episodes_titles = Array.from({ length: matches.length }, (_, i) =>
    (i + 1).toString(),
  );

  // 提取标题
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  // 提取描述
  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/,
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  // 提取封面
  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  // 提取年份
  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    episodes_titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
    remarks: undefined, // HTML解析无法获取remarks信息
  };
}
