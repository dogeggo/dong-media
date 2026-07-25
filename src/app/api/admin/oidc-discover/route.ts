import { NextRequest, NextResponse } from 'next/server';

import { ensureAdmin } from '@/lib/admin-auth';
import {
  parseSafeHttpUrl,
  safeFetch,
  UnsafeUpstreamUrlError,
} from '@/lib/safe-upstream-url';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 },
    );
  }

  try {
    await ensureAdmin(request);

    const { issuerUrl } = await request.json();

    if (!issuerUrl || typeof issuerUrl !== 'string') {
      return NextResponse.json(
        { error: 'Issuer URL不能为空' },
        { status: 400 },
      );
    }

    const issuer = parseSafeHttpUrl(issuerUrl);
    if (process.env.NODE_ENV === 'production' && issuer.protocol !== 'https:') {
      return NextResponse.json(
        { error: '生产环境 OIDC Issuer 必须使用 HTTPS' },
        { status: 400 },
      );
    }
    const wellKnownUrl = `${issuer.toString().replace(/\/$/, '')}/.well-known/openid-configuration`;

    // 通过后端获取配置，避免CORS问题
    const response = await safeFetch(wellKnownUrl, {
      method: 'GET',
      maxRedirects: 2,
      headers: {
        Accept: 'application/json',
      },
      // 设置超时
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `无法获取OIDC配置: ${response.status} ${response.statusText}`,
        },
        { status: 400 },
      );
    }

    const responseText = await response.text();
    if (Buffer.byteLength(responseText) > 1024 * 1024) {
      return NextResponse.json({ error: 'OIDC配置响应过大' }, { status: 400 });
    }
    const data = JSON.parse(responseText);

    // 验证返回的数据包含必需的端点
    // 注意：userinfo_endpoint 对某些提供商（如 Apple）是可选的
    if (!data.authorization_endpoint || !data.token_endpoint) {
      return NextResponse.json(
        {
          error: 'OIDC配置不完整，缺少必需的端点',
        },
        { status: 400 },
      );
    }
    if (
      typeof data.issuer !== 'string' ||
      data.issuer.replace(/\/$/, '') !== issuer.toString().replace(/\/$/, '')
    ) {
      return NextResponse.json(
        { error: 'OIDC发现结果的 issuer 与请求不一致' },
        { status: 400 },
      );
    }
    for (const endpoint of [
      data.authorization_endpoint,
      data.token_endpoint,
      data.userinfo_endpoint,
      data.jwks_uri,
    ]) {
      if (endpoint) parseSafeHttpUrl(endpoint);
    }

    // 返回端点配置
    return NextResponse.json({
      authorization_endpoint: data.authorization_endpoint,
      token_endpoint: data.token_endpoint,
      userinfo_endpoint: data.userinfo_endpoint || '', // Apple 等提供商可能没有此端点
      jwks_uri: data.jwks_uri || '', // JWKS endpoint，用于验证 JWT 签名
      issuer: data.issuer,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error instanceof UnsafeUpstreamUrlError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: '请求超时，请检查Issuer URL是否正确' },
          { status: 408 },
        );
      }
      return NextResponse.json(
        { error: '获取配置失败，请检查 Issuer URL' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: '获取配置失败，请检查Issuer URL是否正确' },
      { status: 500 },
    );
  }
}
