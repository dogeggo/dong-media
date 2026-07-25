import { NextRequest, NextResponse } from 'next/server';

import { authenticateRequest } from '@/lib/request-auth';
import { safeFetch } from '@/lib/safe-upstream-url';

/**
 * YouTube oEmbed API 代理路由
 * 解决客户端直接调用 YouTube API 可能遇到的 CORS 问题
 *
 * 用法:
 * GET /api/proxy/youtube?videoId=dQw4w9WgXcQ
 */
export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');

  if (!videoId) {
    return NextResponse.json(
      { error: 'Missing videoId parameter' },
      { status: 400 },
    );
  }
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return NextResponse.json(
      { error: 'Invalid videoId parameter' },
      { status: 400 },
    );
  }

  try {
    const apiUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    const response = await safeFetch(apiUrl, {
      allowedHosts: ['youtube.com'],
      maxRedirects: 2,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // YouTube oEmbed 对无效视频返回 404
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Video not found or unavailable' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: `YouTube API returned ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();

    // 返回数据，并设置缓存头
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('YouTube API proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from YouTube API' },
      { status: 500 },
    );
  }
}
