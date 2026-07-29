/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  CACHE_POLICIES,
  cacheService,
  normalizeQuery,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { getAvailableApiSites, loadConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { generateSearchVariants } from '@/lib/utils';

export const runtime = 'nodejs';

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return privateJson({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const normalizedQuery = query ? normalizeQuery(query) : '';

    if (!normalizedQuery || normalizedQuery.length > 100) {
      return privateJson({ suggestions: [] });
    }

    const suggestions = await cacheService.getOrLoad(
      CACHE_POLICIES.SEARCH_SUGGESTIONS,
      { query: normalizedQuery },
      () => generateSuggestions(normalizedQuery, authInfo.username),
      {
        scope: authInfo.username,
        isNegative: (value) => value.length === 0,
      },
    );

    return privateJson({ suggestions });
  } catch (error) {
    console.error('获取搜索建议失败', error);
    return privateJson({ error: '获取搜索建议失败' }, { status: 500 });
  }
}

async function generateSuggestions(
  query: string,
  username: string,
): Promise<
  Array<{
    text: string;
    type: 'exact' | 'related' | 'suggestion';
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();

  const apiSites = await getAvailableApiSites(username);
  let realKeywords: string[] = [];

  if (apiSites.length > 0) {
    // 取第一个可用的数据源进行搜索
    const firstSite = apiSites[0];
    const config = await loadConfig();
    const searchVariants = generateSearchVariants(query);
    const maxPage: number = config.SiteConfig.SearchDownstreamMaxPage;
    const results = await searchFromApi(
      firstSite,
      searchVariants,
      maxPage,
      username,
    );
    realKeywords = Array.from(
      new Set(
        results
          .map((r: any) => r.title)
          .filter(Boolean)
          .flatMap((title: string) => title.split(/[ -:：·、-]/))
          .filter(
            (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower),
          ),
      ),
    ).slice(0, 8);
  }

  // 根据关键词与查询的匹配程度计算分数，并动态确定类型
  const realSuggestions = realKeywords.map((word) => {
    const wordLower = word.toLowerCase();
    const queryWords = queryLower.split(/[ -:：·、-]/);

    // 计算匹配分数：完全匹配得分更高
    let score = 1.0;
    if (wordLower === queryLower) {
      score = 2.0; // 完全匹配
    } else if (
      wordLower.startsWith(queryLower) ||
      wordLower.endsWith(queryLower)
    ) {
      score = 1.8; // 前缀或后缀匹配
    } else if (queryWords.some((qw) => wordLower.includes(qw))) {
      score = 1.5; // 包含查询词
    }

    // 根据匹配程度确定类型
    let type: 'exact' | 'related' | 'suggestion' = 'related';
    if (score >= 2.0) {
      type = 'exact';
    } else if (score >= 1.5) {
      type = 'related';
    } else {
      type = 'suggestion';
    }

    return {
      text: word,
      type,
      score,
    };
  });

  // 按分数降序排列，相同分数按类型优先级排列
  const sortedSuggestions = realSuggestions.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score; // 分数高的在前
    }
    // 分数相同时，按类型优先级：exact > related > suggestion
    const typePriority = { exact: 3, related: 2, suggestion: 1 };
    return typePriority[b.type] - typePriority[a.type];
  });

  return sortedSuggestions;
}
