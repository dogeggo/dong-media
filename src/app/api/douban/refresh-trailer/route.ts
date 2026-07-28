import { NextResponse } from 'next/server';
import '@/lib/server-cache';

import { fetchTrailerWithRetry } from '@/lib/douban-api';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      {
        code: 400,
        message: '缺少必要参数: id',
        error: 'MISSING_PARAMETER',
      },
      { status: 400 },
    );
  }

  try {
    const trailerUrl = (await fetchTrailerWithRetry(id)).trailerUrl;

    return NextResponse.json(
      {
        code: 200,
        message: '获取成功',
        data: {
          trailerUrl,
        },
      },
      {
        headers: {
          // 不缓存这个 API 的响应
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        },
      },
    );
  } catch (error) {
    if (error instanceof Error) {
      // 超时错误
      if (error.name === 'AbortError') {
        return NextResponse.json(
          {
            code: 504,
            message: '请求超时，豆瓣响应过慢',
            error: 'TIMEOUT',
          },
          { status: 504 },
        );
      }

      // 没有预告片
      if (error.message.includes('没有预告片')) {
        return NextResponse.json(
          {
            code: 404,
            message: error.message,
            error: 'NO_TRAILER',
          },
          { status: 404 },
        );
      }

      // 其他错误
      return NextResponse.json(
        {
          code: 500,
          message: '刷新 trailer URL 失败',
          error: 'FETCH_ERROR',
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        code: 500,
        message: '刷新 trailer URL 失败',
        error: 'UNKNOWN_ERROR',
      },
      { status: 500 },
    );
  }
}
