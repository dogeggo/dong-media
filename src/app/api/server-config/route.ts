import { NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  hasOnlyUniqueSearchParams,
  noStoreResponseHeaders,
  publicApiResponseHeaders,
} from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!hasOnlyUniqueSearchParams(new URL(request.url).searchParams, [])) {
    return NextResponse.json(
      { error: '包含未知或重复参数' },
      { status: 400, headers: noStoreResponseHeaders() },
    );
  }
  try {
    const cached = await cacheService.getOrLoadResult(
      CACHE_POLICIES.CONFIG_PUBLIC,
      { projection: 'browser-safe' },
      async () => {
        const config = await loadConfig();
        const projection: Record<string, unknown> = {
          SiteName: config.SiteConfig.SiteName,
          StorageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
          DownloadEnabled: config.DownloadConfig?.enabled ?? true,
        };
        const providers = (config.OIDCProviders || [])
          .filter((provider) => provider.enabled)
          .map((provider) => ({
            id: provider.id,
            name: provider.name,
            buttonText: provider.buttonText,
            issuer: provider.issuer,
          }));
        if (providers.length) projection.OIDCProviders = providers;
        return projection;
      },
    );
    return NextResponse.json(cached.value, {
      headers: publicApiResponseHeaders(CACHE_POLICIES.CONFIG_PUBLIC, {
        ttlSeconds: cached.ttlRemaining,
        negative: cached.negative,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: '获取公开配置失败' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
