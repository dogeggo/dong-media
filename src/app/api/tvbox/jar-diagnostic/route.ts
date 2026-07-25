import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { safeFetch } from '@/lib/safe-upstream-url';
import { getAllCandidates } from '@/lib/spiderJar';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

/**
 * TVBox JAR 深度诊断 API
 * 提供详细的 JAR 源测试报告和网络环境分析
 */

interface JarTestResult {
  url: string;
  name: string;
  status: 'success' | 'failed' | 'timeout' | 'invalid';
  responseTime: number;
  fileSize?: number;
  httpStatus?: number;
  error?: string;
  headers?: Record<string, string>;
  isValidJar?: boolean;
  md5?: string;
}

interface DiagnosticReport {
  timestamp: string;
  environment: {
    userAgent: string;
    ip?: string;
    timezone: string;
    isDomestic: boolean;
    recommendedSources: string[];
  };
  jarTests: JarTestResult[];
  summary: {
    totalTested: number;
    successCount: number;
    failedCount: number;
    averageResponseTime: number;
    fastestSource?: string;
    recommendedSource?: string;
  };
  recommendations: string[];
}

// 测试单个 JAR 源
async function testJarSource(
  url: string,
  name: string,
): Promise<JarTestResult> {
  const startTime = Date.now();
  const result: JarTestResult = {
    url,
    name,
    status: 'failed',
    responseTime: 0,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // 优化请求头
    const headers: Record<string, string> = {
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      Connection: 'close',
    };

    if (url.includes('github') || url.includes('raw.githubusercontent')) {
      headers['User-Agent'] = 'curl/7.68.0';
    } else if (url.includes('gitee') || url.includes('gitcode')) {
      headers['User-Agent'] = DEFAULT_USER_AGENT;
    } else {
      headers['User-Agent'] =
        'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Mobile Safari/537.36';
    }

    const response = await safeFetch(url, {
      method: 'HEAD',
      allowedHosts: ['raw.githubusercontent.com'],
      maxRedirects: 2,
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });

    clearTimeout(timeout);
    result.responseTime = Date.now() - startTime;
    result.httpStatus = response.status;

    // 收集响应头信息
    result.headers = {};
    response.headers.forEach((value, key) => {
      if (result.headers) result.headers[key] = value;
    });

    if (!response.ok) {
      result.status = 'failed';
      result.error = `HTTP ${response.status}: ${response.statusText}`;
      return result;
    }

    // 检查文件大小
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      result.fileSize = parseInt(contentLength, 10);
      if (result.fileSize < 1000) {
        result.status = 'invalid';
        result.error = `File too small: ${result.fileSize} bytes`;
        return result;
      }
    }

    // 如果 HEAD 成功，尝试获取部分内容验证
    const verifyController = new AbortController();
    const verifyTimeout = setTimeout(() => verifyController.abort(), 5000);

    const verifyResponse = await safeFetch(url, {
      method: 'GET',
      allowedHosts: ['raw.githubusercontent.com'],
      maxRedirects: 2,
      signal: verifyController.signal,
      headers: {
        ...headers,
        Range: 'bytes=0-1023', // 只获取前 1KB
      },
    });

    clearTimeout(verifyTimeout);

    if (verifyResponse.ok) {
      const buffer = await verifyResponse.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // 验证 JAR 文件头（ZIP 格式）
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        result.isValidJar = true;
        result.status = 'success';

        // 计算 MD5（只对前 1KB）
        result.md5 = crypto
          .createHash('md5')
          .update(Buffer.from(buffer))
          .digest('hex')
          .substring(0, 8);
      } else {
        result.status = 'invalid';
        result.error = 'Invalid JAR file format (not a ZIP file)';
        result.isValidJar = false;
      }
    }

    return result;
  } catch (error: unknown) {
    result.responseTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        result.status = 'timeout';
        result.error = `Timeout after ${result.responseTime}ms`;
      } else {
        result.status = 'failed';
        result.error = error.message;
      }
    } else {
      result.status = 'failed';
      result.error = 'Unknown error';
    }

    return result;
  }
}

// 检测网络环境
function detectEnvironment(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // 简单的国内环境检测
  const isDomestic =
    timezone.includes('Asia/Shanghai') ||
    timezone.includes('Asia/Chongqing') ||
    timezone.includes('Asia/Beijing');

  return {
    userAgent,
    timezone,
    isDomestic,
  };
}

export async function GET(request: NextRequest) {
  const env = detectEnvironment(request);
  const allSources = getAllCandidates();

  // 根据环境选择测试源
  const testSources = env.isDomestic
    ? [
        ...allSources.domestic.map((url) => ({ url, name: '国内CDN' })),
        ...allSources.international.map((url) => ({ url, name: 'GitHub直连' })),
        ...allSources.proxy.map((url) => ({ url, name: '代理源' })),
      ]
    : [
        ...allSources.international.map((url) => ({ url, name: 'GitHub直连' })),
        ...allSources.proxy.map((url) => ({ url, name: '代理源' })),
        ...allSources.domestic.map((url) => ({ url, name: '国内CDN' })),
      ];

  console.log(
    `🔍 开始 JAR 源诊断测试，环境: ${env.isDomestic ? '国内' : '国际'}`,
  );

  // 并发测试所有源（但限制并发数）
  const concurrency = 5;
  const results: JarTestResult[] = [];

  for (let i = 0; i < testSources.length; i += concurrency) {
    const batch = testSources.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((source) => testJarSource(source.url, source.name)),
    );
    results.push(...batchResults);

    console.log(`✅ 完成批次 ${Math.floor(i / concurrency) + 1}`);
  }

  // 分析结果
  const successResults = results.filter((r) => r.status === 'success');
  const failedResults = results.filter((r) => r.status !== 'success');

  const summary = {
    totalTested: results.length,
    successCount: successResults.length,
    failedCount: failedResults.length,
    averageResponseTime:
      results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
    fastestSource: successResults.sort(
      (a, b) => a.responseTime - b.responseTime,
    )[0]?.url,
    recommendedSource: successResults[0]?.url,
  };

  // 生成推荐
  const recommendations: string[] = [];

  if (successResults.length === 0) {
    recommendations.push('❌ 所有 JAR 源均不可用，这可能是网络问题');
    recommendations.push('🔧 建议检查：');
    recommendations.push('  1. 网络连接是否正常');
    recommendations.push('  2. 防火墙或代理设置');
    recommendations.push('  3. DNS 解析是否正常');
    recommendations.push('  4. 尝试切换网络环境（WiFi/移动数据）');
  } else if (successResults.length < 3) {
    recommendations.push('⚠️ 只有少数 JAR 源可用，网络环境可能受限');
    recommendations.push(`✅ 推荐使用: ${summary.fastestSource}`);
    recommendations.push('💡 建议使用 VPN 或代理改善网络环境');
  } else {
    recommendations.push('✅ 网络环境良好，多个 JAR 源可用');
    recommendations.push(`⚡ 最快源: ${summary.fastestSource}`);
    recommendations.push(`🎯 推荐源: ${summary.recommendedSource}`);
  }

  // 分析失败原因
  const timeouts = failedResults.filter((r) => r.status === 'timeout').length;
  const httpErrors = failedResults.filter(
    (r) => r.httpStatus && (r.httpStatus === 403 || r.httpStatus === 404),
  ).length;
  const invalidJars = failedResults.filter(
    (r) => r.status === 'invalid',
  ).length;

  if (timeouts > 0) {
    recommendations.push(`⏱️ 检测到 ${timeouts} 个超时，网络延迟较高`);
  }
  if (httpErrors > 0) {
    recommendations.push(
      `🚫 检测到 ${httpErrors} 个 HTTP 错误（403/404），源文件可能已失效`,
    );
  }
  if (invalidJars > 0) {
    recommendations.push(`⚠️ 检测到 ${invalidJars} 个无效 JAR 文件`);
  }

  const report: DiagnosticReport = {
    timestamp: new Date().toISOString(),
    environment: {
      ...env,
      recommendedSources: testSources.slice(0, 5).map((s) => s.url),
    },
    jarTests: results,
    summary,
    recommendations,
  };

  return NextResponse.json(report, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
