'use client';

import {
  AlertCircle,
  CheckCircle,
  Copy,
  ExternalLink,
  Shield,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

interface TVBoxSecurityConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const TVBoxSecurityConfig = ({
  config,
  refreshConfig,
}: TVBoxSecurityConfigProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [securitySettings, setSecuritySettings] = useState({
    enableIpWhitelist: false,
    allowedIPs: [] as string[],
    enableRateLimit: false,
    rateLimit: 60,
  });

  const [proxySettings, setProxySettings] = useState({
    enabled: false,
    proxyUrl: 'https://corsapi.smone.workers.dev',
  });

  const [newIP, setNewIP] = useState('');
  const [userToken, setUserToken] = useState('');
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState<any>(null);

  // 从config加载设置
  useEffect(() => {
    if (config?.TVBoxSecurityConfig) {
      setSecuritySettings({
        enableIpWhitelist:
          config.TVBoxSecurityConfig.enableIpWhitelist ?? false,
        allowedIPs: config.TVBoxSecurityConfig.allowedIPs || [],
        enableRateLimit: config.TVBoxSecurityConfig.enableRateLimit ?? false,
        rateLimit: config.TVBoxSecurityConfig.rateLimit ?? 60,
      });
    }

    // 加载代理配置
    if (config?.TVBoxProxyConfig) {
      setProxySettings({
        enabled: config.TVBoxProxyConfig.enabled ?? false,
        proxyUrl:
          config.TVBoxProxyConfig.proxyUrl ||
          'https://corsapi.smone.workers.dev',
      });
    }

    void fetch('/api/tvbox-config')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setUserToken(data?.userToken || ''))
      .catch(() => setUserToken(''));
  }, [config]);

  // 显示消息
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 保存配置
  const handleSave = async () => {
    setIsLoading(true);

    try {
      // 验证IP地址格式
      for (const ip of securitySettings.allowedIPs) {
        if (ip && !isValidIPOrCIDR(ip)) {
          showMessage('error', `无效的IP地址或CIDR格式: ${ip}`);
          return;
        }
      }

      if (securitySettings.rateLimit < 1 || securitySettings.rateLimit > 1000) {
        showMessage('error', '频率限制应在1-1000之间');
        return;
      }

      // 验证代理URL
      if (proxySettings.enabled && proxySettings.proxyUrl) {
        try {
          new URL(proxySettings.proxyUrl);
        } catch {
          showMessage('error', '代理URL格式不正确');
          return;
        }
      }

      // 保存安全配置
      const securityResponse = await fetch('/api/admin/tvbox-security', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(securitySettings),
      });

      if (!securityResponse.ok) {
        const errorData = await securityResponse.json();
        throw new Error(errorData.error || '保存安全配置失败');
      }

      // 保存代理配置
      const proxyResponse = await fetch('/api/admin/tvbox-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(proxySettings),
      });

      if (!proxyResponse.ok) {
        const errorData = await proxyResponse.json();
        throw new Error(errorData.error || '保存代理配置失败');
      }

      showMessage('success', 'TVBox配置保存成功！');
      await refreshConfig();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 验证IP地址或CIDR格式
  function isValidIPOrCIDR(ip: string): boolean {
    // 简单的IP地址验证
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    const parts = ip.split('/')[0].split('.');

    if (!ipRegex.test(ip)) return false;

    return parts.every((part) => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // 添加IP地址
  const addIP = () => {
    if (!newIP.trim()) return;

    if (!isValidIPOrCIDR(newIP.trim())) {
      showMessage(
        'error',
        '请输入有效的IP地址或CIDR格式 (例如: 192.168.1.100 或 192.168.1.0/24)',
      );
      return;
    }

    if (securitySettings.allowedIPs.includes(newIP.trim())) {
      showMessage('error', 'IP地址已存在');
      return;
    }

    setSecuritySettings((prev) => ({
      ...prev,
      allowedIPs: [...prev.allowedIPs, newIP.trim()],
    }));
    setNewIP('');
  };

  // 删除IP地址
  const removeIP = (index: number) => {
    setSecuritySettings((prev) => ({
      ...prev,
      allowedIPs: prev.allowedIPs.filter((_, i) => i !== index),
    }));
  };

  const generateExampleURL = () => {
    if (!userToken) return `${window.location.origin}/tvbox`;
    const params = new URLSearchParams({ token: userToken });
    return `${window.location.origin}/api/tvbox?${params.toString()}`;
  };

  const handleDiagnose = async () => {
    if (!userToken) {
      showMessage('error', '当前账号缺少用户专属 TVBox Token');
      return;
    }

    setIsDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const params = new URLSearchParams({ token: userToken });
      const response = await fetch(`/api/tvbox/diagnose?${params.toString()}`);
      const result = await response.json();
      setDiagnoseResult(result);
      showMessage(
        result.pass ? 'success' : 'error',
        result.pass
          ? '配置诊断通过！所有检查项正常'
          : `发现 ${result.issues?.length || 0} 个问题`,
      );
    } catch (error) {
      showMessage(
        'error',
        `诊断失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    } finally {
      setIsDiagnosing(false);
    }
  };

  return (
    <div className='bg-white dark:bg-gray-800 rounded-lg shadow-md p-6'>
      <div className='flex items-center gap-3 mb-6'>
        <Shield className='h-6 w-6 text-primary-600' />
        <h2 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
          TVBox 安全配置
        </h2>
      </div>

      {message && (
        <div
          className={`mb-4 p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className='h-5 w-5' />
          ) : (
            <AlertCircle className='h-5 w-5' />
          )}
          {message.text}
        </div>
      )}

      <div className='space-y-6'>
        {/* IP白名单 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-4'>
          <div className='flex items-center justify-between mb-4'>
            <div>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                IP 白名单
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                只允许指定IP地址访问TVBox接口
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={securitySettings.enableIpWhitelist}
                onChange={(e) =>
                  setSecuritySettings((prev) => ({
                    ...prev,
                    enableIpWhitelist: e.target.checked,
                  }))
                }
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
            </label>
          </div>

          {securitySettings.enableIpWhitelist && (
            <div className='space-y-3'>
              <div className='flex gap-2'>
                <input
                  type='text'
                  value={newIP}
                  onChange={(e) => setNewIP(e.target.value)}
                  placeholder='192.168.1.100 或 192.168.1.0/24'
                  className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  onKeyDown={(e) => e.key === 'Enter' && addIP()}
                />
                <button
                  type='button'
                  onClick={addIP}
                  className='px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg'
                >
                  添加
                </button>
              </div>

              {securitySettings.allowedIPs.length > 0 && (
                <div className='space-y-2'>
                  {securitySettings.allowedIPs.map((ip, index) => (
                    <div
                      key={index}
                      className='flex items-center justify-between bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded'
                    >
                      <span className='text-gray-900 dark:text-gray-100'>
                        {ip}
                      </span>
                      <button
                        onClick={() => removeIP(index)}
                        className='text-red-600 hover:text-red-800 text-sm'
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className='text-xs text-gray-500 dark:text-gray-400'>
                支持单个IP (192.168.1.100) 和CIDR格式 (192.168.1.0/24)
              </p>
            </div>
          )}
        </div>

        {/* 频率限制 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-4'>
          <div className='flex items-center justify-between mb-4'>
            <div>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                访问频率限制
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                限制每个IP每分钟的访问次数，防止滥用
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={securitySettings.enableRateLimit}
                onChange={(e) =>
                  setSecuritySettings((prev) => ({
                    ...prev,
                    enableRateLimit: e.target.checked,
                  }))
                }
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
            </label>
          </div>

          {securitySettings.enableRateLimit && (
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                每分钟请求次数限制
              </label>
              <input
                type='number'
                min='1'
                max='1000'
                value={securitySettings.rateLimit}
                onChange={(e) =>
                  setSecuritySettings((prev) => ({
                    ...prev,
                    rateLimit: parseInt(e.target.value) || 60,
                  }))
                }
                className='w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              />
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                建议设置30-60次，过低可能影响正常使用
              </p>
            </div>
          )}
        </div>

        {/* CDN代理配置 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-4'>
          <div className='flex items-center justify-between mb-4'>
            <div>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                Cloudflare Worker 代理（TVBox专用）
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                为TVBox配置启用Cloudflare全球CDN加速，提升访问速度和稳定性
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={proxySettings.enabled}
                onChange={(e) =>
                  setProxySettings((prev) => ({
                    ...prev,
                    enabled: e.target.checked,
                  }))
                }
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
            </label>
          </div>

          {proxySettings.enabled && (
            <div className='space-y-3'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  Cloudflare Worker 地址
                </label>
                <input
                  type='text'
                  value={proxySettings.proxyUrl}
                  onChange={(e) =>
                    setProxySettings((prev) => ({
                      ...prev,
                      proxyUrl: e.target.value,
                    }))
                  }
                  placeholder='https://your-worker.workers.dev'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                />
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  默认地址：https://corsapi.smone.workers.dev（支持自定义部署）
                </p>
              </div>

              <div className='bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-3'>
                <h4 className='text-sm font-semibold text-primary-900 dark:text-primary-300 mb-2'>
                  💡 功能说明
                </h4>
                <ul className='text-xs text-primary-800 dark:text-primary-300 space-y-1'>
                  <li>• 通过Cloudflare全球CDN加速视频源API访问</li>
                  <li>• 自动转发TVBox的所有API参数（ac=list, ac=detail等）</li>
                  <li>• 为每个源生成唯一路径，提升兼容性</li>
                  <li>• 支持自定义Worker地址，可部署自己的代理服务</li>
                </ul>
              </div>

              <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3'>
                <h4 className='text-sm font-semibold text-yellow-900 dark:text-yellow-300 mb-2'>
                  ⚠️ 部署说明
                </h4>
                <p className='text-xs text-yellow-800 dark:text-yellow-300'>
                  如需自定义部署，请参考：
                  <a
                    href='https://github.com/SzeMeng76/CORSAPI'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='underline hover:text-yellow-600'
                  >
                    CORSAPI项目
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* URL示例 */}
        <div className='bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-4'>
          <h3 className='text-sm font-semibold text-primary-900 dark:text-primary-300 mb-2'>
            当前用户的 TVBox 配置URL
          </h3>
          <div className='space-y-2'>
            {/* URL显示区域 */}
            <div className='bg-white dark:bg-gray-800 px-3 py-2 rounded border'>
              <code className='block text-sm text-gray-900 dark:text-gray-100 break-all leading-relaxed'>
                {generateExampleURL()}
              </code>
            </div>

            {/* 操作按钮 */}
            <div className='flex flex-col sm:flex-row gap-2'>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generateExampleURL());
                  showMessage('success', 'URL已复制到剪贴板');
                }}
                className='flex-1 sm:flex-none px-4 py-2 text-sm bg-primary-100 dark:bg-primary-800 hover:bg-primary-200 dark:hover:bg-primary-700 text-primary-700 dark:text-primary-300 rounded-lg flex items-center justify-center gap-2 transition-colors'
              >
                <Copy className='h-4 w-4' />
                复制URL
              </button>
              <a
                href={generateExampleURL()}
                target='_blank'
                rel='noopener noreferrer'
                className='flex-1 sm:flex-none px-4 py-2 text-sm bg-primary-100 dark:bg-primary-800 hover:bg-primary-200 dark:hover:bg-primary-700 text-primary-700 dark:text-primary-300 rounded-lg flex items-center justify-center gap-2 transition-colors'
              >
                <ExternalLink className='h-4 w-4' />
                测试访问
              </a>
              <button
                onClick={handleDiagnose}
                disabled={isDiagnosing}
                className='flex-1 sm:flex-none px-4 py-2 text-sm bg-purple-100 dark:bg-purple-800 hover:bg-purple-200 dark:hover:bg-purple-700 disabled:opacity-50 text-purple-700 dark:text-purple-300 rounded-lg flex items-center justify-center gap-2 transition-colors'
              >
                <svg
                  className='h-4 w-4'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth='2'
                    d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                {isDiagnosing ? '诊断中...' : '诊断配置'}
              </button>
            </div>
          </div>

          <p className='text-xs text-primary-700 dark:text-primary-400 mt-3'>
            💡 此处使用当前登录账号的用户专属 Token。Base64 格式请在URL后添加
            &format=base64。
          </p>
        </div>

        {/* 诊断结果 */}
        {diagnoseResult && (
          <div
            className={`border rounded-lg p-4 ${
              diagnoseResult.pass
                ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            }`}
          >
            <div className='flex items-center gap-2 mb-3'>
              {diagnoseResult.pass ? (
                <CheckCircle className='h-5 w-5 text-primary-600 dark:text-primary-400' />
              ) : (
                <AlertCircle className='h-5 w-5 text-yellow-600 dark:text-yellow-400' />
              )}
              <h3
                className={`text-sm font-semibold ${
                  diagnoseResult.pass
                    ? 'text-primary-900 dark:text-primary-300'
                    : 'text-yellow-900 dark:text-yellow-300'
                }`}
              >
                诊断结果 {diagnoseResult.pass ? '✓ 通过' : '⚠ 发现问题'}
              </h3>
            </div>

            <div className='space-y-2 text-sm'>
              {/* 基本信息 */}
              <div className='grid grid-cols-2 gap-2'>
                <div className='text-gray-600 dark:text-gray-400'>状态码:</div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.status}
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  Content-Type:
                </div>
                <div className='text-gray-900 dark:text-gray-100 text-xs'>
                  {diagnoseResult.contentType || 'N/A'}
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  JSON解析:
                </div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.hasJson ? (
                    <span className='text-primary-600 dark:text-primary-400'>
                      ✓ 成功
                    </span>
                  ) : (
                    <span className='text-red-600 dark:text-red-400'>
                      ✗ 失败
                    </span>
                  )}
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  接收到的Token:
                </div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.receivedToken || 'none'}
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  配置大小:
                </div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.size} 字节
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  影视源数量:
                </div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.sitesCount}
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  直播源数量:
                </div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.livesCount}
                </div>

                <div className='text-gray-600 dark:text-gray-400'>
                  解析源数量:
                </div>
                <div className='text-gray-900 dark:text-gray-100'>
                  {diagnoseResult.parsesCount}
                </div>

                {diagnoseResult.privateApis !== undefined && (
                  <>
                    <div className='text-gray-600 dark:text-gray-400'>
                      私网API数量:
                    </div>
                    <div className='text-gray-900 dark:text-gray-100'>
                      {diagnoseResult.privateApis > 0 ? (
                        <span className='text-yellow-600 dark:text-yellow-400'>
                          {diagnoseResult.privateApis}
                        </span>
                      ) : (
                        <span className='text-primary-600 dark:text-primary-400'>
                          0
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* 配置URL */}
              {diagnoseResult.configUrl && (
                <div className='mt-3 pt-3 border-t border-gray-200 dark:border-gray-700'>
                  <div className='text-gray-600 dark:text-gray-400 mb-1'>
                    配置URL:
                  </div>
                  <div className='text-xs text-gray-900 dark:text-gray-100 break-all bg-white dark:bg-gray-800 p-2 rounded font-mono'>
                    {diagnoseResult.configUrl}
                  </div>
                </div>
              )}

              {/* Spider 信息 */}
              {diagnoseResult.spider && (
                <div className='mt-3 pt-3 border-t border-gray-200 dark:border-gray-700'>
                  <div className='text-gray-600 dark:text-gray-400 mb-1'>
                    Spider JAR:
                  </div>
                  <div className='text-xs text-gray-900 dark:text-gray-100 break-all bg-white dark:bg-gray-800 p-2 rounded'>
                    {diagnoseResult.spider}
                  </div>
                  <div className='mt-2 space-y-1'>
                    {diagnoseResult.spiderPrivate !== undefined && (
                      <div className='text-xs'>
                        {diagnoseResult.spiderPrivate ? (
                          <span className='text-yellow-600 dark:text-yellow-400'>
                            ⚠ Spider 是私网地址
                          </span>
                        ) : (
                          <span className='text-primary-600 dark:text-primary-400'>
                            ✓ Spider 是公网地址
                          </span>
                        )}
                      </div>
                    )}
                    {diagnoseResult.spiderReachable !== undefined && (
                      <div className='text-xs'>
                        {diagnoseResult.spiderReachable ? (
                          <span className='text-primary-600 dark:text-primary-400'>
                            ✓ Spider 可访问
                            {diagnoseResult.spiderStatus &&
                              ` (状态码: ${diagnoseResult.spiderStatus})`}
                          </span>
                        ) : (
                          <span className='text-red-600 dark:text-red-400'>
                            ✗ Spider 不可访问
                            {diagnoseResult.spiderStatus &&
                              ` (状态码: ${diagnoseResult.spiderStatus})`}
                          </span>
                        )}
                      </div>
                    )}
                    {diagnoseResult.spiderSizeKB !== undefined && (
                      <div className='text-xs'>
                        <span
                          className={
                            diagnoseResult.spiderSizeKB < 50
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-primary-600 dark:text-primary-400'
                          }
                        >
                          {diagnoseResult.spiderSizeKB < 50 ? '⚠' : '✓'}{' '}
                          文件大小: {diagnoseResult.spiderSizeKB}KB
                        </span>
                      </div>
                    )}
                    {diagnoseResult.spiderLastModified && (
                      <div className='text-xs text-gray-600 dark:text-gray-400'>
                        最后修改:{' '}
                        {new Date(
                          diagnoseResult.spiderLastModified,
                        ).toLocaleString('zh-CN')}
                      </div>
                    )}
                  </div>

                  {/* Spider Jar 状态（新增）*/}
                  {((diagnoseResult as any).spider_url ||
                    (diagnoseResult as any).spider_md5) && (
                    <div className='mt-2 p-2 bg-primary-50 dark:bg-primary-900/20 rounded text-xs'>
                      <div className='font-medium text-primary-800 dark:text-primary-200 mb-1'>
                        Spider Jar 状态:
                      </div>
                      <div className='space-y-0.5 text-primary-700 dark:text-primary-300'>
                        {(diagnoseResult as any).spider_url && (
                          <div>
                            • 客户端地址: {(diagnoseResult as any).spider_url}
                          </div>
                        )}
                        {(diagnoseResult as any).spider_upstream && (
                          <div>
                            • 服务端上游:{' '}
                            {(diagnoseResult as any).spider_upstream}
                          </div>
                        )}
                        {(diagnoseResult as any).spider_md5 && (
                          <div>• MD5: {(diagnoseResult as any).spider_md5}</div>
                        )}
                        {(diagnoseResult as any).spider_cached !==
                          undefined && (
                          <div>
                            • 缓存:{' '}
                            {(diagnoseResult as any).spider_cached
                              ? '✓ 是'
                              : '✗ 否（实时下载）'}
                          </div>
                        )}
                        {(diagnoseResult as any).spider_real_size !==
                          undefined && (
                          <div>
                            • 真实大小:{' '}
                            {Math.round(
                              (diagnoseResult as any).spider_real_size / 1024,
                            )}
                            KB
                          </div>
                        )}
                        {(diagnoseResult as any).spider_tried !== undefined && (
                          <div>
                            • 尝试次数: {(diagnoseResult as any).spider_tried}
                          </div>
                        )}
                        {(diagnoseResult as any).spider_success !==
                          undefined && (
                          <div>
                            • 状态:{' '}
                            {(diagnoseResult as any).spider_success
                              ? '✓ 成功'
                              : '✗ 降级（使用fallback jar）'}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 备用代理地址（新增）*/}
                  {(diagnoseResult as any).spider_backup && (
                    <div className='mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs'>
                      <div className='text-gray-600 dark:text-gray-400 mb-1'>
                        备用代理地址:
                      </div>
                      <div className='text-gray-900 dark:text-gray-100 break-all font-mono'>
                        {(diagnoseResult as any).spider_backup}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 问题列表 */}
              {diagnoseResult.issues && diagnoseResult.issues.length > 0 && (
                <div className='mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-800'>
                  <div className='text-yellow-900 dark:text-yellow-300 font-medium mb-2'>
                    发现以下问题:
                  </div>
                  <ul className='list-disc list-inside space-y-1 text-yellow-800 dark:text-yellow-400'>
                    {diagnoseResult.issues.map((issue: string, idx: number) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <div className='flex justify-end pt-6'>
        <button
          onClick={handleSave}
          disabled={isLoading}
          className='px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors'
        >
          {isLoading ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );
};

export default TVBoxSecurityConfig;
