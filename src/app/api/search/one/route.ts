import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getAvailableApiSites, loadConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';

export const runtime = 'nodejs';

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    return privateJson({
      result: null,
      error: '缺少必要参数: q 或 resourceId',
    });
  }
  const apiSites = await getAvailableApiSites(authInfo.username);

  try {
    // 根据 resourceId 查找对应的 API 站点
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return privateJson(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 },
      );
    }
    const config = await loadConfig();
    const maxPage: number = config.SiteConfig.SearchDownstreamMaxPage;
    let results = await searchFromApi(
      targetSite,
      [query],
      maxPage,
      authInfo.username,
    );
    results = results.filter((r) => r.title === query);
    if (results.length === 0) {
      return privateJson(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 },
      );
    } else {
      return privateJson({ results });
    }
  } catch (_error) {
    return privateJson(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 },
    );
  }
}
