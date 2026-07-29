export const DEFAULT_TVBOX_CATEGORIES = [
  '电影',
  '电视剧',
  '综艺',
  '动漫',
  '纪录片',
  '短剧',
] as const;

const CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CATEGORY_FETCH_TIMEOUT_MS = 10_000;

type CategoryFetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface CategoryCacheEntry {
  categories: string[];
  expiresAt: number;
}

const categoryCache = new Map<string, CategoryCacheEntry>();
const categoryRequests = new Map<string, Promise<string[]>>();

function defaultCategories(): string[] {
  return [...DEFAULT_TVBOX_CATEGORIES];
}

/**
 * 为分类探测构造上游 URL。若 API 已通过视频代理包装，则把 ac=list 加到 url
 * 参数中的目标地址，并继续通过已配置的代理探测。
 */
export function buildTVBoxCategoriesUrl(api: string): string | null {
  try {
    const configuredUrl = new URL(api);
    const nestedUrl = configuredUrl.searchParams.get('url');
    if (nestedUrl) {
      const upstreamUrl = new URL(nestedUrl);
      if (!['http:', 'https:'].includes(upstreamUrl.protocol)) return null;
      upstreamUrl.searchParams.set('ac', 'list');
      configuredUrl.searchParams.set('url', upstreamUrl.toString());
      return configuredUrl.toString();
    }

    if (!['http:', 'https:'].includes(configuredUrl.protocol)) return null;
    configuredUrl.searchParams.set('ac', 'list');
    return configuredUrl.toString();
  } catch {
    return null;
  }
}

/** 解析常见 MacCMS 分类响应；HTML、空分类及其他结构均视为不可用。 */
export function parseTVBoxCategories(raw: string): string[] | null {
  const normalized = raw.trim();
  if (!normalized || normalized.startsWith('<')) return null;

  try {
    const data = JSON.parse(normalized) as Record<string, unknown>;
    if (!Array.isArray(data.class)) return null;

    const categories = data.class
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const category = item as Record<string, unknown>;
        if (typeof category.type_name === 'string') return category.type_name;
        if (typeof category.name === 'string') return category.name;
        return '';
      })
      .map((name) => name.trim())
      .filter(Boolean);

    return categories.length ? [...new Set(categories)] : null;
  } catch {
    return null;
  }
}

/**
 * 获取并缓存 TVBox 分类。分类探测只是配置增强项，因此所有上游错误都静默回退；
 * 成功和失败结果都会缓存，防止每次拉取 TVBox 配置都重复请求异常上游。
 */
export async function getTVBoxCategories(
  api: string,
  fetcher: CategoryFetcher = fetch,
): Promise<string[]> {
  const categoriesUrl = buildTVBoxCategoriesUrl(api);
  if (!categoriesUrl) return defaultCategories();

  const now = Date.now();
  const cached = categoryCache.get(categoriesUrl);
  if (cached && cached.expiresAt > now) {
    return [...cached.categories];
  }
  if (cached) categoryCache.delete(categoriesUrl);

  const existingRequest = categoryRequests.get(categoriesUrl);
  if (existingRequest) return [...(await existingRequest)];

  const request = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CATEGORY_FETCH_TIMEOUT_MS,
    );
    let categories = defaultCategories();

    try {
      const response = await fetcher(categoriesUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'TVBox/1.0.0',
        },
      });
      if (response.ok) {
        categories =
          parseTVBoxCategories(await response.text()) || defaultCategories();
      } else {
        await response.body?.cancel();
      }
    } catch {
      // 可选的分类探测失败不应阻断配置生成或持续污染生产日志。
    } finally {
      clearTimeout(timeoutId);
    }

    categoryCache.set(categoriesUrl, {
      categories,
      expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS,
    });
    return categories;
  })();

  categoryRequests.set(categoriesUrl, request);
  try {
    return [...(await request)];
  } finally {
    categoryRequests.delete(categoriesUrl);
  }
}

export function clearTVBoxCategoryCache(): void {
  categoryCache.clear();
  categoryRequests.clear();
}
