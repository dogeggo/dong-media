import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';

import { loadConfig } from '@/lib/config';
import { parseSafeHttpUrl } from '@/lib/safe-upstream-url';
import { sealSession } from '@/lib/sealed-session';
import { getSiteOrigin } from '@/lib/site-origin';

export const runtime = 'nodejs';

function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export async function GET(request: NextRequest) {
  try {
    const providerId =
      request.nextUrl.searchParams.get('provider') || 'default';
    const config = await loadConfig();
    const provider =
      providerId === 'default'
        ? config.OIDCProviders?.find((candidate) => candidate.enabled)
        : config.OIDCProviders?.find(
            (candidate) => candidate.id === providerId && candidate.enabled,
          );

    if (!provider) {
      return NextResponse.json(
        { error: 'OIDC Provider 未启用' },
        { status: 403 },
      );
    }
    if (!provider.authorizationEndpoint || !provider.clientId) {
      return NextResponse.json(
        { error: 'OIDC Provider 配置不完整' },
        { status: 500 },
      );
    }

    const secret = process.env.PASSWORD;
    if (!secret) {
      return NextResponse.json(
        { error: '服务器认证密钥未配置' },
        { status: 500 },
      );
    }

    const origin = getSiteOrigin(request);
    const redirectUri = `${origin}/api/auth/oidc/callback`;
    const state = randomBase64Url();
    const nonce = randomBase64Url();
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const authUrl = parseSafeHttpUrl(provider.authorizationEndpoint);

    if (provider.id === 'wechat') {
      authUrl.searchParams.set('appid', provider.clientId);
      authUrl.searchParams.set('scope', 'snsapi_login');
    } else {
      authUrl.searchParams.set('client_id', provider.clientId);
      const scope =
        provider.id === 'github'
          ? 'read:user user:email'
          : provider.id === 'facebook'
            ? 'public_profile email'
            : provider.id === 'apple'
              ? 'name email'
              : 'openid profile email';
      authUrl.searchParams.set('scope', scope);
    }
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    if (provider.id !== 'wechat') {
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
    }
    if (!['facebook', 'github', 'wechat'].includes(provider.id)) {
      authUrl.searchParams.set('nonce', nonce);
    }
    if (provider.id === 'apple') {
      authUrl.searchParams.set('response_mode', 'form_post');
    }

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(
      'oidc_state',
      sealSession(
        {
          state,
          nonce,
          codeVerifier,
          providerId: provider.id,
          origin,
          timestamp: Date.now(),
        },
        'oidc-state',
        secret,
      ),
      {
        path: '/',
        httpOnly: true,
        secure: origin.startsWith('https://'),
        sameSite: provider.id === 'apple' ? 'none' : 'lax',
        maxAge: 600,
      },
    );
    return response;
  } catch {
    return NextResponse.json({ error: 'OIDC 登录发起失败' }, { status: 500 });
  }
}
