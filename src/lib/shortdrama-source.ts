export interface CmsCategory {
  type_id?: string | number;
  type_name?: string;
  type_pid?: string | number;
}

export interface ShortDramaCategoryTree {
  rootId: string;
  categoryIds: string[];
  descendantIds: string[];
  categories: Array<{ id: string; name: string }>;
  descendants: Array<{ id: string; name: string }>;
}

const BLOCKED_CATEGORY_KEYWORDS = ['擦边', '伦理', '成人'];

function normalizeCategoryId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function isBlockedCategoryName(name: string): boolean {
  return BLOCKED_CATEGORY_KEYWORDS.some((keyword) => name.includes(keyword));
}

function isShortDramaCategoryName(name: string): boolean {
  return name.includes('短剧') && !isBlockedCategoryName(name);
}

/**
 * 苹果 CMS 的“短剧”经常只是一个不直接挂载影片的父分类，真实内容位于
 * “现代都市”“古装仙侠”等子分类。这里把分类树展开，同时保持独立的
 * “爽文短剧”等分类可被识别。
 */
export function findShortDramaCategoryTrees(
  categories: CmsCategory[],
): ShortDramaCategoryTree[] {
  const normalized = categories
    .map((category) => {
      const id = normalizeCategoryId(category.type_id);
      if (!id) return null;
      return {
        id,
        name: String(category.type_name || '').trim(),
        parentId: normalizeCategoryId(category.type_pid),
      };
    })
    .filter((category): category is NonNullable<typeof category> => !!category);

  const categoryById = new Map(
    normalized.map((category) => [category.id, category]),
  );
  const childrenByParent = new Map<string, string[]>();
  normalized.forEach((category) => {
    if (!category.parentId) return;
    const children = childrenByParent.get(category.parentId) || [];
    children.push(category.id);
    childrenByParent.set(category.parentId, children);
  });

  const matchingIds = new Set(
    normalized
      .filter((category) => isShortDramaCategoryName(category.name))
      .map((category) => category.id),
  );

  // 如果一个名称也含“短剧”的分类已经处于另一个短剧分类之下，只保留
  // 最上层根节点，避免同一棵树被重复探测。
  const rootIds = normalized
    .filter((category) => matchingIds.has(category.id))
    .filter((category) => {
      const visited = new Set<string>();
      let parentId = category.parentId;
      while (parentId && !visited.has(parentId)) {
        if (matchingIds.has(parentId)) return false;
        visited.add(parentId);
        parentId = categoryById.get(parentId)?.parentId || null;
      }
      return true;
    })
    .map((category) => category.id)
    .sort((left, right) => {
      const leftExact = categoryById.get(left)?.name === '短剧' ? 0 : 1;
      const rightExact = categoryById.get(right)?.name === '短剧' ? 0 : 1;
      return leftExact - rightExact;
    });

  return rootIds.map((rootId) => {
    const categoryIds: string[] = [];
    const queue = [rootId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const categoryId = queue.shift()!;
      if (visited.has(categoryId)) continue;
      visited.add(categoryId);

      const category = categoryById.get(categoryId);
      if (!category || isBlockedCategoryName(category.name)) continue;

      categoryIds.push(categoryId);
      queue.push(...(childrenByParent.get(categoryId) || []));
    }

    const categoryItems = categoryIds.map((categoryId) => ({
      id: categoryId,
      name: categoryById.get(categoryId)?.name || '',
    }));

    return {
      rootId,
      categoryIds,
      descendantIds: categoryIds.filter((categoryId) => categoryId !== rootId),
      categories: categoryItems,
      descendants: categoryItems.filter((category) => category.id !== rootId),
    };
  });
}

export function matchShortDramaCategoryId(
  tree: ShortDramaCategoryTree,
  requestedId: string,
  requestedName?: string,
): string | null {
  const requestedCategory = tree.categories.find(
    (category) => category.id === requestedId,
  );
  if (
    requestedCategory &&
    (!requestedName || requestedCategory.name === requestedName)
  ) {
    return requestedCategory.id;
  }

  if (!requestedName) return null;
  return (
    tree.categories.find((category) => category.name === requestedName)?.id ||
    null
  );
}

export function uniqueHttpUrls(urls: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  urls.forEach((candidate) => {
    const value = candidate?.trim();
    if (!value) return;

    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      const normalized = url.toString();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      result.push(normalized);
    } catch {
      // 管理配置中的无效 URL 交给保存接口提示；运行时只跳过，继续找备用源。
    }
  });

  return result;
}

export function normalizeShortDramaSourceKeys(
  configuredKeys: unknown,
  legacyApiUrls: unknown,
  sources: Array<{ key: string; api: string }>,
): string[] {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const result: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(configuredKeys)) {
    configuredKeys.forEach((candidate) => {
      if (
        typeof candidate === 'string' &&
        sourceByKey.has(candidate) &&
        !seen.has(candidate)
      ) {
        seen.add(candidate);
        result.push(candidate);
      }
    });
    return result;
  }

  if (typeof legacyApiUrls !== 'string') return result;

  const sourceKeyByUrl = new Map<string, string>();
  sources.forEach((source) => {
    const [normalizedUrl] = uniqueHttpUrls([source.api]);
    if (normalizedUrl && !sourceKeyByUrl.has(normalizedUrl)) {
      sourceKeyByUrl.set(normalizedUrl, source.key);
    }
  });

  uniqueHttpUrls(legacyApiUrls.split(';')).forEach((url) => {
    const sourceKey = sourceKeyByUrl.get(url);
    if (sourceKey && !seen.has(sourceKey)) {
      seen.add(sourceKey);
      result.push(sourceKey);
    }
  });

  return result;
}
