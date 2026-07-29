/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import type { AuthRole } from '@/lib/auth';
import { createUserAuthCookieValue } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { generateTVBoxToken } from '@/lib/tvbox-token';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'kvrocks'
    | undefined) || 'localstorage';

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  username: string,
  role: AuthRole = 'user',
): Promise<string> {
  if (!process.env.PASSWORD) {
    throw new Error('PASSWORD is required to create an authenticated session');
  }
  return createUserAuthCookieValue(username, role, process.env.PASSWORD);
}

export async function POST(req: NextRequest) {
  try {
    // localStorage 模式不支持注册
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: 'localStorage 模式不支持用户注册' },
        { status: 400 },
      );
    }

    const { username, password, confirmPassword } = await req.json();

    // 先检查配置中是否允许注册（在验证输入之前）
    let config: AdminConfig;
    try {
      config = await loadConfig();
      const allowRegister = config.UserConfig?.AllowRegister !== false; // 默认允许注册

      if (!allowRegister) {
        return NextResponse.json(
          { error: '管理员已关闭用户注册功能' },
          { status: 403 },
        );
      }
    } catch (err) {
      console.error('检查注册配置失败', err);
      return NextResponse.json(
        { error: '注册失败，请稍后重试' },
        { status: 500 },
      );
    }

    // 验证输入
    if (!username || typeof username !== 'string' || username.trim() === '') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: '两次输入的密码不一致' },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码长度至少6位' }, { status: 400 });
    }

    // 检查是否与管理员用户名冲突
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '该用户名已被使用' }, { status: 400 });
    }

    // 检查用户名格式（只允许字母数字和下划线）
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字和下划线，长度3-20位' },
        { status: 400 },
      );
    }

    try {
      // 检查用户是否已存在
      const userExists = await db.checkUserExist(username);
      if (userExists) {
        return NextResponse.json(
          { error: '该用户名已被注册' },
          { status: 400 },
        );
      }
      // 获取默认用户组
      const defaultTags =
        config.SiteConfig.DefaultUserTags &&
        config.SiteConfig.DefaultUserTags.length > 0
          ? config.SiteConfig.DefaultUserTags
          : undefined;
      // V2 注册（支持 tags）
      await db.createUser(
        username,
        password,
        'user',
        defaultTags, // 默认分组
        undefined, // oidcSub
        undefined, // enabledApis
      );

      const createdUser = await db.getUserInfo(username);
      if (!createdUser) {
        return NextResponse.json({ error: '创建用户失败' }, { status: 500 });
      }
      const newUser = {
        username: createdUser.username,
        role: createdUser.role,
        banned: createdUser.banned,
        enabledApis: createdUser.enabledApis,
        tags: createdUser.tags,
        createdAt: createdUser.createdAt,
        oidcSub: createdUser.oidcSub,
        tvboxToken: generateTVBoxToken(),
      };
      config.UserConfig.Users.push(newUser);
      await db.saveAdminConfig(config);
      // 验证用户是否成功创建并包含tags（调试用）
      try {
        console.log('=== 调试：验证用户创建 ===');
        const verifyUser = await db.getUserInfo(username);
        console.log('数据库中的用户信息:', verifyUser);
      } catch (debugErr) {
        console.error('调试日志失败:', debugErr);
      }

      const response = NextResponse.json({
        ok: true,
        message: '注册成功，已自动登录',
        needDelay: false,
      });

      const cookieValue = await generateAuthCookie(username, 'user');
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
      console.error('注册用户失败', err);
      return NextResponse.json(
        { error: '注册失败，请稍后重试' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
