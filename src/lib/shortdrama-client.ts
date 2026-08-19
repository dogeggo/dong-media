import type { ShortDramaCategory, ShortDramaItem } from './types';

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) {
        message = data.error;
      }
    } catch {
      // 非 JSON 错误响应使用 HTTP 状态提示。
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function getShortDramaCategories(): Promise<ShortDramaCategory[]> {
  return requestJson('/api/shortdrama/categories');
}

export async function getShortDramaList(
  category: number,
  page = 1,
  categoryName?: string,
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    categoryId: String(category),
    page: String(page),
  });
  if (categoryName) params.set('categoryName', categoryName);
  return requestJson(`/api/shortdrama/list?${params.toString()}`);
}

export async function searchShortDramas(
  query: string,
  page = 1,
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  const params = new URLSearchParams({ query, page: String(page) });
  return requestJson(`/api/shortdrama/search?${params.toString()}`);
}
