import { NextRequest, NextResponse } from 'next/server';

import { createUserAuthCookieValue } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  fetchJsonWithLimit,
  isOauthOnlyProvider,
  verifyOidcIdToken,
} from '@/lib/oidc';
import { safeFetch } from '@/lib/safe-upstream-url';
import { sealSession, unsealSession } from '@/lib/sealed-session';
import { normalizeSiteOrigin } from '@/lib/site-origin';

export const runtime = 'nodejs';

interface OidcStateSession {
  state: string;
  nonce: string;
  codeVerifier: string;
  providerId: string;
  origin: string;
  timestamp: number;
}

interface CallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
}

function loginError(origin: string, message: string) {
  const url = new URL('/login', origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

async function processCallback(request: NextRequest, params: CallbackParams) {
  const secret = process.env.PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: '服务器认证密钥未配置' },
      { status: 500 },
    );
  }

  const sealedState = request.cookies.get('oidc_state')?.value;
  const stateSession = sealedState
    ? unsealSession<OidcStateSession>(sealedState, 'oidc-state', secret)
    : null;
  const fallbackOrigin = process.env.SITE_BASE
    ? normalizeSiteOrigin(process.env.SITE_BASE)
    : request.nextUrl.origin;
  const origin = stateSession?.origin
    ? normalizeSiteOrigin(stateSession.origin)
    : fallbackOrigin;

  if (params.error) return loginError(origin, 'OIDC认证失败');
  if (
    !params.code ||
    !params.state ||
    !stateSession ||
    stateSession.state !== params.state ||
    Date.now() - stateSession.timestamp > 600_000 ||
    Date.now() < stateSession.timestamp - 300_000
  ) {
    return loginError(origin, 'OIDC状态验证失败');
  }

  try {
    const config = await loadConfig();
    const provider = config.OIDCProviders?.find(
      (candidate) =>
        candidate.id === stateSession.providerId && candidate.enabled,
    );
    if (
      !provider ||
      !provider.tokenEndpoint ||
      !provider.userInfoEndpoint ||
      !provider.clientId ||
      !provider.clientSecret
    ) {
      return loginError(origin, 'OIDC配置不完整');
    }

    const redirectUri = `${origin}/api/auth/oidc/callback`;
    const tokenRequest: Record<string, string> =
      provider.id === 'wechat'
        ? {
            appid: provider.clientId,
            secret: provider.clientSecret,
            code: params.code,
            grant_type: 'authorization_code',
          }
        : {
            grant_type: 'authorization_code',
            code: params.code,
            redirect_uri: redirectUri,
            client_id: provider.clientId,
            client_secret: provider.clientSecret,
            code_verifier: stateSession.codeVerifier,
          };

    const tokenResponse = await safeFetch(provider.tokenEndpoint, {
      method: 'POST',
      maxRedirects: 0,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(tokenRequest),
    });
    if (!tokenResponse.ok) {
      await tokenResponse.body?.cancel();
      return loginError(origin, 'OIDC令牌交换失败');
    }
    const tokenText = await tokenResponse.text();
    if (Buffer.byteLength(tokenText) > 1024 * 1024) {
      return loginError(origin, 'OIDC令牌响应无效');
    }
    const tokenData = JSON.parse(tokenText) as Record<string, unknown>;
    const accessToken =
      typeof tokenData.access_token === 'string'
        ? tokenData.access_token
        : null;
    const idToken =
      typeof tokenData.id_token === 'string' ? tokenData.id_token : null;
    const openid =
      typeof tokenData.openid === 'string' ? tokenData.openid : null;
    if (!accessToken || (!idToken && !isOauthOnlyProvider(provider.id))) {
      return loginError(origin, 'OIDC令牌无效');
    }

    const verifiedIdPayload = idToken
      ? await verifyOidcIdToken({
          idToken,
          provider,
          nonce: stateSession.nonce,
        })
      : null;

    let userInfo: Record<string, unknown>;
    if (provider.id === 'apple') {
      userInfo = { ...verifiedIdPayload };
    } else {
      let userInfoUrl = provider.userInfoEndpoint;
      const userInfoHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      };

      if (provider.id === 'facebook') {
        const parsed = new URL(userInfoUrl);
        parsed.searchParams.set('fields', 'id,name,email');
        userInfoUrl = parsed.toString();
      } else if (provider.id === 'wechat') {
        const parsed = new URL(userInfoUrl);
        parsed.searchParams.set('access_token', accessToken);
        if (openid) parsed.searchParams.set('openid', openid);
        userInfoUrl = parsed.toString();
        delete userInfoHeaders.Authorization;
      } else if (provider.id === 'github') {
        userInfoHeaders.Accept = 'application/vnd.github+json';
        userInfoHeaders['X-GitHub-Api-Version'] = '2022-11-28';
      }

      userInfo = (await fetchJsonWithLimit(userInfoUrl, {
        maxRedirects: 0,
        cache: 'no-store',
        headers: userInfoHeaders,
      })) as Record<string, unknown>;

      if (
        verifiedIdPayload?.sub &&
        userInfo.sub &&
        verifiedIdPayload.sub !== userInfo.sub
      ) {
        return loginError(origin, 'OIDC用户标识不一致');
      }

      if (provider.id === 'github' && !userInfo.email) {
        const emails = (await fetchJsonWithLimit(
          'https://api.github.com/user/emails',
          {
            allowedHosts: ['api.github.com'],
            maxRedirects: 0,
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        )) as Array<{ email?: string; primary?: boolean; verified?: boolean }>;
        const preferred =
          emails.find((email) => email.primary && email.verified) ||
          emails.find((email) => email.verified);
        if (preferred?.email) userInfo.email = preferred.email;
      }
    }

    const providerSubject =
      verifiedIdPayload?.sub || userInfo.sub || userInfo.id || openid;
    if (
      typeof providerSubject !== 'string' &&
      typeof providerSubject !== 'number'
    ) {
      return loginError(origin, 'OIDC用户信息无效');
    }
    const oidcSub = `${provider.id}:${String(providerSubject)}`;

    let username = await db.getUserByOidcSub(oidcSub);
    let role: 'owner' | 'admin' | 'user' = 'user';
    if (username) {
      const existing = await db.getUserInfo(username);
      if (!existing || existing.banned) return loginError(origin, '用户被封禁');
      role = existing.role;
    } else {
      const existing = config.UserConfig.Users.find(
        (candidate) => candidate.oidcSub === oidcSub,
      );
      if (existing) {
        if (existing.banned) return loginError(origin, '用户被封禁');
        username = existing.username;
        role = existing.role;
      }
    }

    if (username) {
      const response = NextResponse.redirect(new URL('/', origin));
      response.cookies.set(
        'user_auth',
        await createUserAuthCookieValue(username, role, secret),
        {
          path: '/',
          expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          sameSite: 'lax',
          httpOnly: false,
          secure: origin.startsWith('https://'),
        },
      );
      response.cookies.delete('oidc_state');
      return response;
    }

    if (!provider.enableRegistration) {
      return loginError(origin, '该OIDC账号未注册');
    }

    const response = NextResponse.redirect(new URL('/oidc-register', origin));
    response.cookies.set(
      'oidc_session',
      sealSession(
        {
          sub: oidcSub,
          email:
            typeof userInfo.email === 'string' ? userInfo.email : undefined,
          name: typeof userInfo.name === 'string' ? userInfo.name : undefined,
          trust_level:
            typeof userInfo.trust_level === 'number'
              ? userInfo.trust_level
              : undefined,
          providerId: provider.id,
          timestamp: Date.now(),
        },
        'oidc-registration',
        secret,
      ),
      {
        path: '/',
        httpOnly: true,
        secure: origin.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 600,
      },
    );
    response.cookies.delete('oidc_state');
    return response;
  } catch {
    return loginError(origin, 'OIDC认证处理失败');
  }
}

export async function GET(request: NextRequest) {
  return processCallback(request, {
    code: request.nextUrl.searchParams.get('code'),
    state: request.nextUrl.searchParams.get('state'),
    error: request.nextUrl.searchParams.get('error'),
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  return processCallback(request, {
    code:
      typeof formData.get('code') === 'string'
        ? String(formData.get('code'))
        : null,
    state:
      typeof formData.get('state') === 'string'
        ? String(formData.get('state'))
        : null,
    error:
      typeof formData.get('error') === 'string'
        ? String(formData.get('error'))
        : null,
  });
}
