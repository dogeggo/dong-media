/* eslint-disable no-console */

import 'server-only';

import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

import {
  findShortDramaCategoryTrees,
  matchShortDramaCategoryId,
  ShortDramaCategoryTree,
  uniqueHttpUrls,
} from './shortdrama-source';
import { ShortDramaCategory, ShortDramaItem } from './types';

const SOURCE_DISCOVERY_TTL_MS = 5 * 60 * 1000;
const SOURCE_DISCOVERY_CONCURRENCY = 4;
const SOURCE_REQUEST_TIMEOUT_MS = 10_000;

interface CmsResponse {
  class?: unknown;
  list?: unknown;
  page?: string | number;
  pagecount?: string | number;
  total?: string | number;
}

interface SourceInspection {
  url: string;
  directSource?: ResolvedShortDramaSource;
  categoryTrees: ShortDramaCategoryTree[];
}

interface ResolvedShortDramaSource {
  url: string;
  categoryId: string;
  categoryIds: string[];
}

interface ResolvedCategorySource {
  url: string;
  tree: ShortDramaCategoryTree;
}

export class ShortDramaCategoryNotFoundError extends Error {
  constructor() {
    super('短剧分类不存在或已经失效');
    this.name = 'ShortDramaCategoryNotFoundError';
  }
}

interface DiscoveryCacheEntry {
  expiresAt: number;
  value: Promise<SourceInspection | null>;
}

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

function buildApiUrl(
  baseUrl: string,
  params: Record<string, string | number>,
): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchCmsJson(
  baseUrl: string,
  params: Record<string, string | number>,
): Promise<CmsResponse> {
  const response = await fetch(buildApiUrl(baseUrl, params), {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(SOURCE_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`短剧源响应异常（HTTP ${response.status}）`);
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('短剧源返回了非 JSON 数据');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('短剧源返回格式错误');
  }

  return data as CmsResponse;
}

function getCmsList(data: CmsResponse): any[] {
  return Array.isArray(data.list) ? data.list : [];
}

function hasCmsItems(data: CmsResponse): boolean {
  return getCmsList(data).length > 0;
}

async function inspectSourceUncached(
  url: string,
): Promise<SourceInspection | null> {
  const categoryResponse = await fetchCmsJson(url, { ac: 'list' });
  const categories = Array.isArray(categoryResponse.class)
    ? categoryResponse.class
    : [];
  const categoryTrees = findShortDramaCategoryTrees(categories);
  if (categoryTrees.length === 0) return null;

  for (const tree of categoryTrees) {
    const page = await fetchCmsJson(url, {
      ac: 'detail',
      t: tree.rootId,
      pg: 1,
    });
    if (hasCmsItems(page)) {
      return {
        url,
        categoryTrees,
        directSource: {
          url,
          categoryId: tree.rootId,
          categoryIds: tree.categoryIds,
        },
      };
    }
  }

  return { url, categoryTrees };
}

async function inspectSource(url: string): Promise<SourceInspection | null> {
  const now = Date.now();
  const cached = discoveryCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = inspectSourceUncached(url).catch((error) => {
    console.warn(`短剧源探测失败: ${url}`, error);
    return null;
  });
  discoveryCache.set(url, {
    expiresAt: now + SOURCE_DISCOVERY_TTL_MS,
    value,
  });
  return value;
}

async function getSelectedSourceUrls(): Promise<string[]> {
  const { loadConfig } = await import('@/lib/config');
  const config = await loadConfig();
  const sourceByKey = new Map(
    (config.SourceConfig || [])
      .filter((source) => !source.disabled && !source.is_adult)
      .map((source) => [source.key, source]),
  );
  const urls = uniqueHttpUrls(
    (config.ShortDramaConfig?.sourceKeys || []).map(
      (sourceKey) => sourceByKey.get(sourceKey)?.api,
    ),
  );
  if (urls.length === 0) {
    throw new Error('未选择可用短剧源，请先在管理后台配置');
  }
  return urls;
}

async function findFirstDescendantSource(
  inspection: SourceInspection,
): Promise<ResolvedShortDramaSource | null> {
  for (const tree of inspection.categoryTrees) {
    for (
      let offset = 0;
      offset < tree.descendantIds.length;
      offset += SOURCE_DISCOVERY_CONCURRENCY
    ) {
      const categoryIds = tree.descendantIds.slice(
        offset,
        offset + SOURCE_DISCOVERY_CONCURRENCY,
      );
      const pages = await Promise.all(
        categoryIds.map((categoryId) =>
          fetchCmsJson(inspection.url, {
            ac: 'detail',
            t: categoryId,
            pg: 1,
          }).catch(() => null),
        ),
      );
      const usableIndex = pages.findIndex(
        (page) => page !== null && hasCmsItems(page),
      );
      if (usableIndex >= 0) {
        return {
          url: inspection.url,
          categoryId: categoryIds[usableIndex],
          categoryIds: tree.categoryIds,
        };
      }
    }
  }

  return null;
}

async function resolveShortDramaSource(
  urls: string[],
  excludedUrls = new Set<string>(),
): Promise<ResolvedShortDramaSource> {
  for (const url of urls) {
    if (excludedUrls.has(url)) continue;
    const inspection = await inspectSource(url);
    if (!inspection) continue;
    if (inspection.directSource) return inspection.directSource;

    // 必须先完整检查当前源的子分类，再进入下一个已选源，确保配置顺序
    // 就是实际故障转移顺序。
    const descendantSource = await findFirstDescendantSource(inspection);
    if (descendantSource) return descendantSource;
  }

  throw new Error('所有已选影视源均未找到可用短剧数据');
}

async function resolveCategorySource(
  urls: string[],
  excludedUrls = new Set<string>(),
): Promise<ResolvedCategorySource> {
  for (const url of urls) {
    if (excludedUrls.has(url)) continue;
    const inspection = await inspectSource(url);
    if (!inspection) continue;
    const resolvedSource =
      inspection.directSource || (await findFirstDescendantSource(inspection));
    if (!resolvedSource) continue;

    const tree = inspection.categoryTrees.find((candidate) =>
      candidate.categoryIds.includes(resolvedSource.categoryId),
    );
    if (tree) return { url: inspection.url, tree };
  }
  throw new Error('所有已选影视源均未返回短剧分类');
}

function getEpisodeCount(item: any): number {
  const total = Number(item?.vod_total);
  if (Number.isFinite(total) && total > 0) return total;

  const serial = Number(item?.vod_serial);
  if (Number.isFinite(serial) && serial > 0) return serial;

  return 1;
}

function mapShortDramaItems(items: any[]): ShortDramaItem[] {
  return items
    .filter((item) => item && item.vod_id != null && item.vod_name)
    .map((item) => ({
      id: Number(item.vod_id),
      name: String(item.vod_name),
      cover: String(item.vod_pic || ''),
      update_time: String(item.vod_time || ''),
      score: Number.parseFloat(item.vod_score) || 0,
      episode_count: getEpisodeCount(item),
      description: String(item.vod_content || item.vod_blurb || ''),
      author: String(item.vod_actor || ''),
      backdrop: String(item.vod_pic_slide || item.vod_pic || ''),
      vote_average: Number.parseFloat(item.vod_score) || 0,
    }))
    .filter((item) => Number.isFinite(item.id));
}

function hasMorePages(data: CmsResponse): boolean {
  const page = Number(data.page);
  const pageCount = Number(data.pagecount);
  return (
    Number.isFinite(page) && Number.isFinite(pageCount) && page < pageCount
  );
}

export async function getShortDramaCategories(): Promise<ShortDramaCategory[]> {
  const urls = await getSelectedSourceUrls();
  const source = await resolveCategorySource(urls);
  const sourceCategories =
    source.tree.descendants.length > 0
      ? source.tree.descendants
      : source.tree.categories.filter(
          (category) => category.id === source.tree.rootId,
        );
  const seenNames = new Set<string>();
  const categories = sourceCategories.flatMap((category) => {
    const typeId = Number(category.id);
    const typeName = category.name;
    if (
      !Number.isSafeInteger(typeId) ||
      typeId <= 0 ||
      typeId === 1 ||
      !typeName ||
      seenNames.has(typeName)
    ) {
      return [];
    }
    seenNames.add(typeName);
    return [{ type_id: typeId, type_name: typeName }];
  });

  return [{ type_id: 1, type_name: '全部短剧' }, ...categories];
}

export async function getRecommendedShortDramas(
  size = 15,
): Promise<ShortDramaItem[]> {
  try {
    const urls = await getSelectedSourceUrls();
    const excludedUrls = new Set<string>();
    let lastError: unknown;

    while (excludedUrls.size < urls.length) {
      let source: ResolvedShortDramaSource;
      try {
        source = await resolveShortDramaSource(urls, excludedUrls);
      } catch (error) {
        lastError = error;
        break;
      }

      try {
        const data = await fetchCmsJson(source.url, {
          ac: 'detail',
          t: source.categoryId,
          pg: 1,
        });
        const items = mapShortDramaItems(getCmsList(data)).slice(0, size);
        if (items.length > 0) return items;
        lastError = new Error('所选短剧源没有返回推荐数据');
      } catch (error) {
        lastError = error;
        discoveryCache.delete(source.url);
      }
      excludedUrls.add(source.url);
    }

    throw lastError || new Error('所有已选影视源均未返回推荐短剧');
  } catch (error) {
    console.error('获取推荐短剧失败:', error);
    throw error;
  }
}

export async function getShortDramaList(
  category: number,
  page = 1,
  categoryName?: string,
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  try {
    const urls = await getSelectedSourceUrls();
    const excludedUrls = new Set<string>();
    let lastError: unknown;
    let matchedCategory = category === 1;

    while (excludedUrls.size < urls.length) {
      let source: ResolvedShortDramaSource;
      try {
        if (category === 1) {
          source = await resolveShortDramaSource(urls, excludedUrls);
        } else {
          const categorySource = await resolveCategorySource(
            urls,
            excludedUrls,
          );
          const categoryId = matchShortDramaCategoryId(
            categorySource.tree,
            String(category),
            categoryName,
          );
          if (!categoryId) {
            excludedUrls.add(categorySource.url);
            continue;
          }
          matchedCategory = true;
          source = {
            url: categorySource.url,
            categoryId,
            categoryIds: [categoryId],
          };
        }
      } catch (error) {
        lastError = error;
        break;
      }

      try {
        const data = await fetchCmsJson(source.url, {
          ac: 'detail',
          t: source.categoryId,
          pg: page,
        });
        const list = mapShortDramaItems(getCmsList(data));
        if (page > 1 || list.length > 0) {
          return { list, hasMore: hasMorePages(data) };
        }
        lastError = new Error('当前所选源的短剧分类没有数据');
      } catch (error) {
        lastError = error;
        discoveryCache.delete(source.url);
      }
      excludedUrls.add(source.url);
    }

    if (!matchedCategory) throw new ShortDramaCategoryNotFoundError();
    throw lastError || new Error('所有已选影视源均未返回短剧列表');
  } catch (error) {
    if (!(error instanceof ShortDramaCategoryNotFoundError)) {
      console.error('获取短剧列表失败:', error);
    }
    throw error;
  }
}

export async function searchShortDramas(
  query: string,
  page = 1,
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  try {
    const urls = await getSelectedSourceUrls();
    const excludedUrls = new Set<string>();
    let lastError: unknown;
    let receivedEmptyResponse = false;

    while (excludedUrls.size < urls.length) {
      let source: ResolvedShortDramaSource;
      try {
        source = await resolveShortDramaSource(urls, excludedUrls);
      } catch (error) {
        lastError = error;
        break;
      }

      try {
        const data = await fetchCmsJson(source.url, {
          ac: 'detail',
          t: source.categoryId,
          wd: query,
          pg: page,
        });
        const allowedCategoryIds = new Set(source.categoryIds);
        const items = getCmsList(data).filter((item) =>
          allowedCategoryIds.has(String(item?.type_id)),
        );
        const list = mapShortDramaItems(items);
        if (list.length > 0) {
          return { list, hasMore: hasMorePages(data) };
        }
        receivedEmptyResponse = true;
      } catch (error) {
        lastError = error;
        discoveryCache.delete(source.url);
      }
      excludedUrls.add(source.url);
    }

    if (receivedEmptyResponse) return { list: [], hasMore: false };
    throw lastError || new Error('所有已选影视源搜索均失败');
  } catch (error) {
    console.error('搜索短剧失败:', error);
    throw error;
  }
}
