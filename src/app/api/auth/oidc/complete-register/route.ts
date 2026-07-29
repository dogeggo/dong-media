import { NextRequest, NextResponse } from 'next/server';

import { createUserAuthCookieValue } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { unsealSession } from '@/lib/sealed-session';
import { generateTVBoxToken } from '@/lib/tvbox-token';

export const runtime = 'nodejs';

interface OidcRegistrationSession {
  sub: string;
  providerId: string;
  trust_level?: number;
  timestamp: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const username =
      typeof body.username === 'string' ? body.username.trim() : '';
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字、下划线，长度3-20位' },
        { status: 400 },
      );
    }

    const secret = process.env.PASSWORD;
    const cookie = request.cookies.get('oidc_session')?.value;
    const session =
      secret && cookie
        ? unsealSession<OidcRegistrationSession>(
            cookie,
            'oidc-registration',
            secret,
          )
        : null;
    if (
      !secret ||
      !session ||
      !session.sub ||
      !session.providerId ||
      !Number.isSafeInteger(session.timestamp) ||
      Date.now() - session.timestamp > 600_000 ||
      Date.now() < session.timestamp - 300_000
    ) {
      return NextResponse.json(
        { error: 'OIDC会话已过期，请重新登录' },
        { status: 400 },
      );
    }

    let config = await loadConfig();
    const provider = config.OIDCProviders?.find(
      (candidate) =>
        candidate.id === session.providerId &&
        candidate.enabled &&
        candidate.enableRegistration,
    );
    if (!provider) {
      return NextResponse.json({ error: 'OIDC注册未启用' }, { status: 403 });
    }
    if (
      (provider.minTrustLevel || 0) > 0 &&
      (session.trust_level ?? 0) < provider.minTrustLevel
    ) {
      return NextResponse.json({ error: 'OIDC信任等级不足' }, { status: 403 });
    }
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '该用户名不可用' }, { status: 409 });
    }
    if (
      (await db.checkUserExist(username)) ||
      config.UserConfig.Users.some(
        (candidate) => candidate.username === username,
      )
    ) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }
    if (
      (await db.getUserByOidcSub(session.sub)) ||
      config.UserConfig.Users.some(
        (candidate) => candidate.oidcSub === session.sub,
      )
    ) {
      return NextResponse.json(
        { error: '该OIDC账号已被注册' },
        { status: 409 },
      );
    }

    const defaultTags = config.SiteConfig.DefaultUserTags?.length
      ? config.SiteConfig.DefaultUserTags
      : undefined;
    await db.createUser(
      username,
      crypto.randomUUID(),
      'user',
      defaultTags,
      session.sub,
      undefined,
    );
    const createdUser = await db.getUserInfo(username);
    if (!createdUser) {
      return NextResponse.json({ error: '创建用户失败' }, { status: 500 });
    }
    config.UserConfig.Users.push({
      username: createdUser.username,
      role: createdUser.role,
      banned: createdUser.banned,
      enabledApis: createdUser.enabledApis,
      tags: createdUser.tags,
      createdAt: createdUser.createdAt,
      oidcSub: createdUser.oidcSub,
      tvboxToken: generateTVBoxToken(),
    });
    await db.saveAdminConfig(config);

    const response = NextResponse.json({ ok: true, redirect: '/' });
    response.cookies.set(
      'user_auth',
      await createUserAuthCookieValue(username, 'user', secret),
      {
        path: '/',
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sameSite: 'lax',
        httpOnly: false,
        secure: request.nextUrl.protocol === 'https:',
      },
    );
    response.cookies.delete('oidc_session');
    return response;
  } catch {
    return NextResponse.json({ error: 'OIDC注册失败' }, { status: 500 });
  }
}
