/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getAvailableApiSites, loadConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { generateSearchVariants } from '@/lib/utils';

export const runtime = 'nodejs';

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return privateJson({ results: [] });
  }
  const apiSites = await getAvailableApiSites(authInfo.username);
  const config = await loadConfig();
  const searchVariants = generateSearchVariants(query);
  const maxPage: number = config.SiteConfig.SearchDownstreamMaxPage;
  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, searchVariants, maxPage, authInfo.username),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 15000),
      ),
    ]).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // 返回空数组而不是抛出错误
    }),
  );

  try {
    const results = await Promise.all(searchPromises);
    let flattenedResults: SearchResult[] = results.flat();
    if (flattenedResults.length === 0) {
      return privateJson({ results: [] }, { status: 200 });
    }
    return privateJson({ results: flattenedResults });
  } catch (_error) {
    return privateJson({ error: '搜索失败' }, { status: 500 });
  }
}
