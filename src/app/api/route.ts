import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getShowAdultContent } from '@/lib/config';

/**
 * 根路径 API 端点
 * 提供服务器状态信息和成人内容过滤模式检测
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: noStoreResponseHeaders() },
    );
  }
  // 判断是否启用成人内容过滤
  // 默认启用过滤（家庭安全模式）
  const adultFilterEnabled = !(await getShowAdultContent(authInfo.username));

  const response = NextResponse.json({
    status: 'ok',
    version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    authenticated: true,
    adultFilterEnabled,
    message: adultFilterEnabled
      ? '家庭安全模式 - 成人内容已过滤'
      : '完整内容模式 - 显示所有内容',
  });
  noStoreResponseHeaders().forEach((value, key) =>
    response.headers.set(key, value),
  );

  // 设置 CORS 头
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Content-Mode',
  );

  // 设置内容模式响应头
  response.headers.set(
    'X-Adult-Filter',
    adultFilterEnabled ? 'enabled' : 'disabled',
  );

  return response;
}

/**
 * 处理 CORS 预检请求
 */
export async function OPTIONS() {
  const response = new NextResponse(null, {
    status: 204,
    headers: noStoreResponseHeaders(),
  });

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Content-Mode',
  );

  return response;
}
