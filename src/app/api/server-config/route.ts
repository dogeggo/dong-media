import { NextResponse } from 'next/server';

import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET() {
  const config = await loadConfig();

  const result: any = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    DownloadEnabled: config.DownloadConfig?.enabled ?? true,
  };

  // 添加 OIDC 登录配置（仅公开必要信息）
  // 优先使用新的多 Provider 配置
  if (config.OIDCProviders && config.OIDCProviders.length > 0) {
    // 只返回启用的 Provider 的公开信息
    const enabledProviders = config.OIDCProviders.filter((p) => p.enabled).map(
      (p) => ({
        id: p.id,
        name: p.name,
        buttonText: p.buttonText,
        issuer: p.issuer, // 用于provider检测（公开信息，不敏感）
        // 注意：不返回 ClientSecret、Endpoints 等敏感信息
      }),
    );

    if (enabledProviders.length > 0) {
      result.OIDCProviders = enabledProviders;
    }
  }

  return NextResponse.json(result);
}
