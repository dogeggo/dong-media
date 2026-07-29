import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getAvailableApiSites } from '@/lib/config';

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

  try {
    const apiSites = await getAvailableApiSites(authInfo.username);

    // 只返回必要的字段，避免敏感信息泄露
    const sources = apiSites.map((site) => ({
      key: site.key,
      name: site.name,
    }));

    return privateJson(sources);
  } catch (error) {
    console.error('获取数据源列表失败:', error);
    return privateJson({ error: '获取数据源列表失败' }, { status: 500 });
  }
}
