'use client';

import { AlertCircle, CheckCircle, Filter, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  type AdFilterConfig,
  type AdFilterSourceRule,
  DEFAULT_AD_FILTER_CONFIG,
  normalizeAdFilterConfig,
} from '@/lib/ad-filter';
import type { AdminConfig } from '@/lib/admin.types';

interface CustomAdFilterConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

function rulesToText(rules: AdFilterSourceRule[]) {
  return JSON.stringify(rules, null, 2);
}

export default function CustomAdFilterConfig({
  config,
  refreshConfig,
}: CustomAdFilterConfigProps) {
  const [settings, setSettings] = useState<AdFilterConfig>({
    ...DEFAULT_AD_FILTER_CONFIG,
  });
  const [sourceRulesText, setSourceRulesText] = useState('[]');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    const normalized = normalizeAdFilterConfig(
      config?.SiteConfig.AdFilterConfig,
    );
    setSettings(normalized);
    setSourceRulesText(rulesToText(normalized.sourceRules));
  }, [config]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      if (!config) throw new Error('配置未加载');

      let sourceRules: unknown;
      try {
        sourceRules = JSON.parse(sourceRulesText);
      } catch {
        throw new Error('源专属规则不是有效的 JSON');
      }
      if (!Array.isArray(sourceRules)) {
        throw new Error('源专属规则必须是 JSON 数组');
      }

      const normalized = normalizeAdFilterConfig({
        ...settings,
        sourceRules,
      });
      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          SiteConfig: {
            ...config.SiteConfig,
            AdFilterConfig: normalized,
          },
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '保存失败');
      }

      setSettings(normalized);
      setSourceRulesText(rulesToText(normalized.sourceRules));
      showMessage('success', '结构化去广告规则已保存');
      await refreshConfig();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsLoading(false);
    }
  };

  const restoreDefaults = () => {
    setSettings({ ...DEFAULT_AD_FILTER_CONFIG });
    setSourceRulesText('[]');
  };

  return (
    <div className='space-y-6'>
      <div className='flex items-start gap-3'>
        <Filter className='mt-1 h-6 w-6 shrink-0 text-purple-500' />
        <div>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            结构化去广告规则
          </h3>
          <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
            使用关键词、广告标记和片段时长过滤 M3U8，不执行任何自定义
            JavaScript。
          </p>
        </div>
      </div>

      <div className='rounded-lg border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-900/20'>
        <div className='flex items-start gap-3 text-sm text-primary-800 dark:text-primary-200'>
          <Info className='mt-0.5 h-5 w-5 shrink-0' />
          <p>
            全局关键词会匹配媒体片段 URL；源专属规则可以按源 key
            添加关键词或广告片段时长。所有输入仅作为数据解析，不会作为代码运行。
          </p>
        </div>
      </div>

      <label className='flex items-center gap-3'>
        <input
          type='checkbox'
          checked={settings.enabled}
          onChange={(event) =>
            setSettings({ ...settings, enabled: event.target.checked })
          }
          className='h-4 w-4 rounded border-gray-300 text-purple-600'
        />
        <span className='text-sm font-medium text-gray-800 dark:text-gray-200'>
          启用 M3U8 去广告
        </span>
      </label>

      <div className='grid gap-4 md:grid-cols-2'>
        <label className='flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
          <input
            type='checkbox'
            checked={settings.removeCueBlocks}
            onChange={(event) =>
              setSettings({
                ...settings,
                removeCueBlocks: event.target.checked,
              })
            }
            className='h-4 w-4 rounded border-gray-300 text-purple-600'
          />
          <span className='text-sm text-gray-700 dark:text-gray-300'>
            移除 CUE-OUT/CUE-IN 广告区块
          </span>
        </label>
        <label className='flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
          <input
            type='checkbox'
            checked={settings.removeDiscontinuity}
            onChange={(event) =>
              setSettings({
                ...settings,
                removeDiscontinuity: event.target.checked,
              })
            }
            className='h-4 w-4 rounded border-gray-300 text-purple-600'
          />
          <span className='text-sm text-gray-700 dark:text-gray-300'>
            移除 EXT-X-DISCONTINUITY 标记
          </span>
        </label>
      </div>

      <div>
        <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
          全局广告关键词（每行一个）
        </label>
        <textarea
          value={settings.globalKeywords.join('\n')}
          onChange={(event) =>
            setSettings({
              ...settings,
              globalKeywords: event.target.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
          className='h-48 w-full resize-y rounded-lg border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
      </div>

      <div>
        <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
          源专属规则（JSON 数组）
        </label>
        <textarea
          value={sourceRulesText}
          onChange={(event) => setSourceRulesText(event.target.value)}
          className='h-64 w-full resize-y rounded-lg border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          spellCheck={false}
        />
        <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
          示例：
          <code className='ml-1'>
            {`[{"source":"ruyi","keywords":["/promo/"],"durations":[5.64,2.96]}]`}
          </code>
        </p>
      </div>

      <div>
        <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
          规则版本号
        </label>
        <input
          type='number'
          min='1'
          value={settings.version}
          onChange={(event) =>
            setSettings({
              ...settings,
              version: Number.parseInt(event.target.value, 10) || 1,
            })
          }
          className='w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-4 ${
            message.type === 'success'
              ? 'border-primary-200 bg-primary-50 text-primary-800 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className='h-5 w-5 shrink-0' />
          ) : (
            <AlertCircle className='h-5 w-5 shrink-0' />
          )}
          <span className='text-sm'>{message.text}</span>
        </div>
      )}

      <div className='flex gap-3 border-t border-gray-200 pt-4 dark:border-gray-700'>
        <button
          onClick={handleSave}
          disabled={isLoading}
          className='rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-700 disabled:bg-purple-400'
        >
          {isLoading ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={restoreDefaults}
          disabled={isLoading}
          className='rounded-lg bg-gray-600 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-700 disabled:bg-gray-400'
        >
          恢复默认值
        </button>
      </div>
    </div>
  );
}
