/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import type { AuthInfo, AuthRole } from '@/lib/auth';
import { generateHmacSignature, localStorageSessionPayload } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  LOGIN_RETURN_TO_COOKIE,
  sanitizeInternalRedirect,
} from '@/lib/safe-redirect';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'kvrocks'
    | undefined) || 'localstorage';

// 生成认证Cookie（带签名）
async function generateAuthCookie(options: {
  username?: string;
  role?: AuthRole;
  createLocalStorageSession?: boolean;
}): Promise<string> {
  const role = options.role || 'user';
  const timestamp = Date.now();
  const authData: AuthInfo = {
    role,
    timestamp,
    loginTime: timestamp,
  };

  if (options.createLocalStorageSession && process.env.PASSWORD) {
    authData.signature = await generateHmacSignature(
      localStorageSessionPayload(role, timestamp),
      process.env.PASSWORD,
    );
  } else if (options.username && process.env.PASSWORD) {
    authData.username = options.username;
    authData.signature = await generateHmacSignature(
      options.username,
      process.env.PASSWORD,
    );
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    console.log('[Login] 收到登录请求');
    console.log('[Login] STORAGE_TYPE:', STORAGE_TYPE);

    const requestBody = await req.json().catch(() => ({}));
    const requestedRedirect =
      typeof requestBody.redirect === 'string'
        ? requestBody.redirect
        : req.cookies.get(LOGIN_RETURN_TO_COOKIE)?.value;
    const safeRedirect = sanitizeInternalRedirect(requestedRedirect);

    const createSuccessResponse = () => {
      const response = NextResponse.json({
        ok: true,
        redirect: safeRedirect,
      });
      response.cookies.set(LOGIN_RETURN_TO_COOKIE, '', {
        path: '/',
        expires: new Date(0),
        httpOnly: true,
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
      });
      return response;
    };

    // 本地 / localStorage 模式——仅校验固定密码
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未配置 PASSWORD 时直接放行
      if (!envPassword) {
        const response = createSuccessResponse();

        // 清除可能存在的认证cookie
        response.cookies.set('user_auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax', // 改为 lax 以支持 PWA
          httpOnly: false, // PWA 需要客户端可访问
          secure: false, // 根据协议自动设置
        });

        return response;
      }

      const { password } = requestBody;
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 },
        );
      }

      // 验证成功，设置认证cookie
      const response = createSuccessResponse();
      const cookieValue = await generateAuthCookie({
        role: 'user',
        createLocalStorageSession: true,
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('user_auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure: req.nextUrl.protocol === 'https:',
      });

      return response;
    }

    // 数据库 / redis 模式——校验用户名并尝试连接数据库
    const { username, password } = requestBody;
    console.log('[Login] Redis 模式登录');
    console.log('[Login] 收到的用户名:', username);
    console.log('[Login] 是否提供密码:', !!password);

    if (!username || typeof username !== 'string') {
      console.log('[Login] 用户名验证失败');
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      console.log('[Login] 密码验证失败');
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 可能是站长，直接读环境变量
    console.log('[Login] 检查是否为站长账号');
    console.log('[Login] 环境变量 USERNAME:', process.env.USERNAME);
    console.log('[Login] 用户名匹配:', username === process.env.USERNAME);
    console.log('[Login] 密码匹配:', password === process.env.PASSWORD);

    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      console.log('[Login] 站长登录成功');
      // 验证成功，设置认证cookie
      const response = createSuccessResponse();
      const cookieValue = await generateAuthCookie({
        username,
        role: 'owner',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('user_auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure: req.nextUrl.protocol === 'https:',
      });

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await loadConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    // 校验用户密码（V1）
    try {
      const pass = await db.verifyUser(username, password);

      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 },
        );
      }

      // 验证成功，设置认证cookie
      const response = createSuccessResponse();
      const cookieValue = await generateAuthCookie({
        username,
        role: user?.role || 'user',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('user_auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: req.nextUrl.protocol === 'https:',
      });

      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
