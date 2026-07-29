import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { authenticateRequest } from '@/lib/request-auth';
import { safeFetch } from '@/lib/safe-upstream-url';
import { processImageUrl } from '@/lib/utils';

/**
 * Bangumi API 代理路由
 * 解决客户端直接调用 Bangumi API 可能遇到的 CORS 问题
 *
 * 用法:
 * GET /api/proxy/bangumi?path=calendar
 * GET /api/proxy/bangumi?path=v0/subjects/12345
 */
export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (!path) {
    return NextResponse.json(
      { error: 'Missing path parameter' },
      { status: 400 },
    );
  }

  if (
    path.includes('..') ||
    path.startsWith('/') ||
    !/^[a-zA-Z0-9_/?=&.-]+$/.test(path)
  ) {
    return NextResponse.json(
      { error: 'Invalid path parameter' },
      { status: 400 },
    );
  }

  try {
    const processedData = await cacheService.getOrLoad(
      CACHE_POLICIES.BANGUMI_PROXY,
      { path },
      async () => {
        const apiUrl = `https://api.bgm.tv/${path}`;

        const response = await safeFetch(apiUrl, {
          allowedHosts: ['api.bgm.tv'],
          maxRedirects: 0,
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Bangumi API returned ${response.status}`);
        }

        const data = await response.json();

        // 递归处理数据中的图片 URL，替换为 image-proxy
        const processImages = (obj: any): any => {
          if (!obj) return obj;

          if (Array.isArray(obj)) {
            return obj.map((item) => processImages(item));
          }

          if (typeof obj === 'object') {
            const newObj: any = {};
            for (const key in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key];
                // 检查是否是图片 URL 字段
                if (
                  (key === 'large' ||
                    key === 'common' ||
                    key === 'medium' ||
                    key === 'small' ||
                    key === 'grid') &&
                  typeof value === 'string' &&
                  value.startsWith('http')
                ) {
                  newObj[key] = processImageUrl(value);
                } else {
                  newObj[key] = processImages(value);
                }
              }
            }
            return newObj;
          }

          return obj;
        };
        return processImages(data);
      },
    );
    return NextResponse.json(processedData, {
      headers: noStoreResponseHeaders({ 'X-Content-Type-Options': 'nosniff' }),
    });
  } catch (error) {
    console.error('Bangumi API proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Bangumi API' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
