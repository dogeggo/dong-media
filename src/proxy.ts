/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  getAuthInfoFromCookie,
  isValidLocalStorageSession,
  verifyHmacSignature,
} from '@/lib/auth';
import {
  LOGIN_RETURN_TO_COOKIE,
  normalizeLoginRedirect,
  sanitizeInternalRedirect,
} from '@/lib/safe-redirect';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = Math.random().toString(36).substring(7);

  // Generate CSP Nonce
  const nonce = btoa(crypto.randomUUID());

  // Create CSP header
  // Note: We allow chrome-extension: scheme for local development extensions
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval' chrome-extension:;
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https:;
    media-src 'self' blob: data: https: http:;
    font-src 'self' data:;
    connect-src 'self' https: http:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;
    frame-ancestors 'none';
    block-all-mixed-content;
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  let response: NextResponse;

  if (pathname === '/login') {
    response = handleLoginEntry(request, requestHeaders);
  } else if (pathname.startsWith('/adult/')) {
    // 处理 /adult/ 路径前缀，重写为实际 API 路径
    // 移除 /adult 前缀
    const newPathname = pathname.replace(/^\/adult/, '');
    // 创建新的 URL
    const url = request.nextUrl.clone();
    url.pathname = newPathname || '/';
    // 添加 adult=1 参数（如果还没有）
    if (!url.searchParams.has('adult')) {
      url.searchParams.set('adult', '1');
    }

    // 重写请求
    // We create a rewrite response but we need to ensure request headers are passed if we continue?
    // Actually rewrite() takes options too? No, only url.
    // But we can return a rewrite response.

    // For rewrite, we want to modify the request headers sent to the destination?
    // NextResponse.rewrite(url, { request: { headers } })
    response = NextResponse.rewrite(url, {
      request: {
        headers: requestHeaders,
      },
    });

    // 设置响应头标识成人内容模式
    response.headers.set('X-Content-Mode', 'adult');

    // 继续执行认证检查（对于 API 路径）
    if (newPathname.startsWith('/api')) {
      // 将重写后的请求传递给认证逻辑
      const modifiedRequest = new NextRequest(url, request);
      // We pass the response we already created so handleAuthentication can use it or chain from it
      // But handleAuthentication creates its own response usually.
      // We need to pass requestHeaders to handleAuthentication
      response = await handleAuthentication(
        modifiedRequest,
        newPathname,
        requestId,
        requestHeaders, // Pass headers
        response,
      );
    }
  } else if (shouldSkipAuth(pathname)) {
    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } else {
    response = await handleAuthentication(
      request,
      pathname,
      requestId,
      requestHeaders,
    );
  }

  // Set CSP header on the response
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );

  if (pathname === '/login' || pathname === '/play') {
    response.headers.set(
      'X-Robots-Tag',
      'noindex, nofollow, noarchive, nosnippet, noimageindex',
    );
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  }

  if (pathname === '/login') {
    response.headers.set('Referrer-Policy', 'no-referrer');
  }

  return response;
}

function handleLoginEntry(
  request: NextRequest,
  requestHeaders: Headers,
): NextResponse {
  const legacyRedirect = request.nextUrl.searchParams.get('redirect');
  if (legacyRedirect === null) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const returnTo = normalizeLoginRedirect(
    legacyRedirect,
    request.nextUrl.searchParams,
  );
  const cleanLoginUrl = new URL('/login', request.url);
  const error = request.nextUrl.searchParams.get('error');
  if (error) cleanLoginUrl.searchParams.set('error', error.slice(0, 200));

  const response = NextResponse.redirect(cleanLoginUrl);
  setReturnToCookie(response, request, returnTo);
  return response;
}

function setReturnToCookie(
  response: NextResponse,
  request: NextRequest,
  returnTo: string,
): void {
  response.cookies.set(
    LOGIN_RETURN_TO_COOKIE,
    sanitizeInternalRedirect(returnTo),
    {
      path: '/',
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      maxAge: 10 * 60,
    },
  );
}

// 提取认证处理逻辑为单独的函数
async function handleAuthentication(
  request: NextRequest,
  pathname: string,
  requestId: string,
  requestHeaders: Headers,
  response?: NextResponse,
) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // 如果没有设置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    console.log(
      `[Middleware ${requestId}] No auth info, failing auth for: ${pathname}`,
    );
    return handleAuthFailure(request, pathname);
  }

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!(await isValidLocalStorageSession(authInfo, process.env.PASSWORD))) {
      return handleAuthFailure(request, pathname);
    }
    return (
      response ||
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
    );
  }

  // 其他模式：只验证签名
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    console.log(`[Middleware ${requestId}] Missing username or signature:`, {
      hasUsername: !!authInfo.username,
      hasSignature: !!authInfo.signature,
    });
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifyHmacSignature(
      authInfo.username,
      authInfo.signature,
      process.env.PASSWORD || '',
    );

    // 签名验证通过即可
    if (isValidSignature) {
      return (
        response ||
        NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        })
      );
    }
  }
  // 签名验证失败或不存在签名
  console.log(
    `[Middleware ${requestId}] Signature verification failed, denying access`,
  );
  return handleAuthFailure(request, pathname);
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string,
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到干净的登录页面，并通过 HttpOnly Cookie 保存站内回跳地址。
  // 避免把完整播放参数暴露在登录 URL 中，也杜绝开放重定向。
  const loginUrl = new URL('/login', request.url);
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  const response = NextResponse.redirect(loginUrl);
  setReturnToCookie(response, request, fullUrl);
  return response;
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/telegram/', // Telegram API 端点
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|register|oidc-register|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/tvbox|api/live/merged|api/parse|api/bing-wallpaper|api/proxy/|api/telegram/|api/auth/oidc/).*)',
  ],
};
