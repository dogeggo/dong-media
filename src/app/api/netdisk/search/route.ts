import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  CACHE_POLICIES,
  cacheService,
  normalizeQuery,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';

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
  const normalizedQuery = query ? normalizeQuery(query) : '';

  if (!normalizedQuery || normalizedQuery.length > 100) {
    return privateJson({ error: '搜索关键词不能为空' }, { status: 400 });
  }

  const config = await loadConfig();
  const netDiskConfig = config.NetDiskConfig;

  // 检查是否启用网盘搜索 - 必须在缓存检查之前
  if (!netDiskConfig?.enabled) {
    return privateJson({ error: '网盘搜索功能未启用' }, { status: 400 });
  }

  if (!netDiskConfig?.pansouUrl) {
    return privateJson({ error: 'PanSou服务地址未配置' }, { status: 400 });
  }

  const enabledCloudTypes = [...(netDiskConfig.enabledCloudTypes || [])].sort();

  try {
    const cachedResult = await cacheService.getOrLoadResult(
      CACHE_POLICIES.NETDISK_SEARCH,
      { query: normalizedQuery, enabledCloudTypes },
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          (netDiskConfig.timeout || 30) * 1000,
        );
        try {
          const pansouResponse = await fetch(
            `${netDiskConfig.pansouUrl}/api/search`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'DongMedia/1.0',
              },
              signal: controller.signal,
              body: JSON.stringify({
                kw: normalizedQuery,
                res: 'merge',
                cloud_types: enabledCloudTypes.length
                  ? enabledCloudTypes
                  : ['baidu', 'aliyun', 'quark', 'tianyi', 'uc'],
              }),
            },
          );
          if (!pansouResponse.ok) {
            throw new Error(`PanSou服务响应错误: ${pansouResponse.status}`);
          }
          const result = await pansouResponse.json();
          return {
            success: true,
            data: {
              total: result.data?.total || 0,
              merged_by_type: result.data?.merged_by_type || {},
              source: 'pansou',
              query: normalizedQuery,
            },
          };
        } finally {
          clearTimeout(timeout);
        }
      },
      { isNegative: (value) => value.data.total === 0 },
    );
    return privateJson({
      ...cachedResult.value,
      cacheStatus: cachedResult.status,
    });
  } catch (error: any) {
    console.error('网盘搜索失败:', error);

    let errorMessage = '网盘搜索失败';
    if (error.name === 'AbortError') {
      errorMessage = '网盘搜索请求超时';
    } else if (error.message) {
      errorMessage = `网盘搜索失败: ${error.message}`;
    }

    return privateJson(
      {
        success: false,
        error: errorMessage,
        suggestion: '请检查PanSou服务是否正常运行或联系管理员',
      },
      { status: 500 },
    );
  }
}
