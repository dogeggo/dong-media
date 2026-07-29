import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';
import { getSpiderJar, getSpiderStatus } from '@/lib/spiderJar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染，避免构建时获取JAR超时

/**
 * Spider JAR 状态检查 API
 * 提供详细的 JAR 获取状态和诊断信息
 */
export async function GET() {
  try {
    const currentStatus = getSpiderStatus();

    const freshJar = await getSpiderJar(false);

    const response = {
      success: true,
      timestamp: Date.now(),
      cached_status: currentStatus,
      fresh_status: {
        success: freshJar.success,
        source: freshJar.source,
        size: freshJar.size,
        md5: freshJar.md5,
        tried_sources: freshJar.tried,
        is_fallback: freshJar.source === 'fallback',
      },
      recommendations: [] as string[],
    };

    // 提供诊断建议
    if (!freshJar.success) {
      response.recommendations.push(
        '所有远程 JAR 源均不可用，正在使用内置备用 JAR',
      );
      response.recommendations.push('请检查网络连接或尝试切换网络环境');
    } else if (freshJar.tried > 2) {
      response.recommendations.push(
        '多个 JAR 源失败后才成功，建议检查网络稳定性',
      );
    }

    if (freshJar.source.includes('github') && freshJar.tried > 1) {
      response.recommendations.push(
        'GitHub 源访问可能受限，建议配置代理或使用国内网络',
      );
    }

    if (freshJar.size < 50000) {
      response.recommendations.push('JAR 文件较小，可能不完整，建议强制刷新');
    }

    return NextResponse.json(response, { headers: noStoreResponseHeaders() });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}

/**
 * 手动刷新 JAR 缓存
 */
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: noStoreResponseHeaders() },
    );
  }
  if (!(await canRefreshSpider(authInfo.username))) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: noStoreResponseHeaders() },
    );
  }

  try {
    const refreshedJar = await getSpiderJar(true);

    if (refreshedJar.cached) {
      return NextResponse.json(
        {
          success: false,
          error: 'JAR 刷新失败，已保留旧缓存',
          stalePreserved: true,
          timestamp: Date.now(),
        },
        { status: 502, headers: noStoreResponseHeaders() },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'JAR 缓存已刷新',
        jar_status: {
          success: refreshedJar.success,
          source: refreshedJar.source,
          size: refreshedJar.size,
          md5: refreshedJar.md5,
          tried_sources: refreshedJar.tried,
        },
        timestamp: Date.now(),
      },
      { headers: noStoreResponseHeaders() },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}

async function canRefreshSpider(username: string): Promise<boolean> {
  if (username === process.env.USERNAME) return true;
  const config = await loadConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === username,
  );
  return Boolean(user && !user.banned && user.role === 'admin');
}
