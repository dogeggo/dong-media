import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { NETDISK_CACHE_EXPIRE } from '@/lib/cache';
import { loadConfig } from '@/lib/config';
import { getCache, setCache } from '@/lib/server-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: '搜索关键词不能为空' }, { status: 400 });
  }

  const config = await loadConfig();
  const netDiskConfig = config.NetDiskConfig;

  // 检查是否启用网盘搜索 - 必须在缓存检查之前
  if (!netDiskConfig?.enabled) {
    return NextResponse.json({ error: '网盘搜索功能未启用' }, { status: 400 });
  }

  if (!netDiskConfig?.pansouUrl) {
    return NextResponse.json(
      { error: 'PanSou服务地址未配置' },
      { status: 400 },
    );
  }

  const enabledCloudTypesStr = (netDiskConfig.enabledCloudTypes || [])
    .sort()
    .join(',');
  // 缓存key包含功能状态，确保功能开启/关闭时缓存隔离
  const cacheKey = `netdisk-search-enabled-${query}-${enabledCloudTypesStr}`;

  // 服务端直接调用数据库（不用ClientCache，避免HTTP循环调用）
  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached,
        fromCache: true,
        cacheSource: 'database',
        cacheTimestamp: new Date().toISOString(),
      });
    }
  } catch (cacheError) {
    console.warn('网盘搜索缓存读取失败:', cacheError);
    // 缓存失败不影响主流程，继续执行
  }

  try {
    // 调用PanSou服务
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      (netDiskConfig.timeout || 30) * 1000,
    );

    const pansouResponse = await fetch(
      `${netDiskConfig.pansouUrl}/api/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LunaTV/1.0',
        },
        signal: controller.signal,
        body: JSON.stringify({
          kw: query,
          res: 'merge',
          cloud_types: netDiskConfig.enabledCloudTypes || [
            'baidu',
            'aliyun',
            'quark',
            'tianyi',
            'uc',
          ],
        }),
      },
    );

    clearTimeout(timeout);

    if (!pansouResponse.ok) {
      throw new Error(
        `PanSou服务响应错误: ${pansouResponse.status} ${pansouResponse.statusText}`,
      );
    }

    const result = await pansouResponse.json();

    // 统一返回格式
    const responseData = {
      success: true,
      data: {
        total: result.data?.total || 0,
        merged_by_type: result.data?.merged_by_type || {},
        source: 'pansou',
        query: query,
        timestamp: new Date().toISOString(),
      },
    };

    // 服务端直接保存到数据库（不用ClientCache，避免HTTP循环调用）
    try {
      await setCache(cacheKey, responseData, NETDISK_CACHE_EXPIRE.search);
    } catch (cacheError) {
      console.warn('网盘搜索缓存保存失败:', cacheError);
    }

    console.log(
      `✅ 网盘搜索完成: "${query}" - ${responseData.data.total} 个结果`,
    );
    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error('网盘搜索失败:', error);

    let errorMessage = '网盘搜索失败';
    if (error.name === 'AbortError') {
      errorMessage = '网盘搜索请求超时';
    } else if (error.message) {
      errorMessage = `网盘搜索失败: ${error.message}`;
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        suggestion: '请检查PanSou服务是否正常运行或联系管理员',
      },
      { status: 500 },
    );
  }
}
