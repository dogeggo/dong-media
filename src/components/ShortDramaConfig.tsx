'use client';

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Database,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

interface ShortDramaConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

function getSourceHost(api: string): string {
  try {
    return new URL(api).host;
  } catch {
    return api;
  }
}

const ShortDramaConfig = ({ config, refreshConfig }: ShortDramaConfigProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [sourceKeys, setSourceKeys] = useState<string[]>([]);

  const availableSources = useMemo(
    () =>
      (config?.SourceConfig || []).filter(
        (source) => !source.disabled && !source.is_adult,
      ),
    [config],
  );

  useEffect(() => {
    const availableKeys = new Set(availableSources.map((source) => source.key));
    setSourceKeys(
      (config?.ShortDramaConfig?.sourceKeys || []).filter((sourceKey) =>
        availableKeys.has(sourceKey),
      ),
    );
  }, [availableSources, config?.ShortDramaConfig?.sourceKeys]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const toggleSource = (sourceKey: string) => {
    setSourceKeys((current) =>
      current.includes(sourceKey)
        ? current.filter((key) => key !== sourceKey)
        : [...current, sourceKey],
    );
  };

  const moveSource = (sourceKey: string, direction: -1 | 1) => {
    setSourceKeys((current) => {
      const index = current.indexOf(sourceKey);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (sourceKeys.length === 0) {
      showMessage('error', '请至少选择一个短剧影视源');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/shortdrama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKeys }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '保存失败');
      }

      showMessage('success', '短剧源优先级保存成功');
      await refreshConfig();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className='space-y-6'>
      {message && (
        <div
          className={`flex items-center space-x-2 rounded-lg border p-3 ${
            message.type === 'success'
              ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className='h-5 w-5' />
          ) : (
            <AlertCircle className='h-5 w-5' />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <div className='rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800'>
        <div className='mb-6'>
          <h3 className='mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100'>
            短剧源配置
          </h3>
          <div className='flex items-start space-x-2 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'>
            <Database className='mt-0.5 h-4 w-4 shrink-0' />
            <span>
              从已有影视源中选择并设置优先级。系统严格按下方顺序请求；当前源故障或没有短剧数据时才尝试下一个，不会使用未选择的源。
            </span>
          </div>
        </div>

        <div className='mb-7'>
          <div className='mb-3 flex items-center justify-between'>
            <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              已选源及优先级
            </label>
            <span className='rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'>
              已选择 {sourceKeys.length} 个
            </span>
          </div>

          {sourceKeys.length === 0 ? (
            <div className='rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300'>
              尚未选择短剧源。未配置时短剧接口会明确报错，不会自动使用其他影视源。
            </div>
          ) : (
            <div className='space-y-2'>
              {sourceKeys.map((sourceKey, index) => {
                const source = availableSources.find(
                  (candidate) => candidate.key === sourceKey,
                );
                if (!source) return null;
                return (
                  <div
                    key={source.key}
                    className='flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50/60 p-3 dark:border-primary-800 dark:bg-primary-900/10'
                  >
                    <span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white'>
                      {index + 1}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {source.name}
                      </div>
                      <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                        {getSourceHost(source.api)} · {source.key}
                      </div>
                    </div>
                    <div className='flex gap-1'>
                      <button
                        type='button'
                        onClick={() => moveSource(source.key, -1)}
                        disabled={index === 0}
                        className='rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        aria-label={`提高 ${source.name} 的优先级`}
                      >
                        <ArrowUp className='h-4 w-4' />
                      </button>
                      <button
                        type='button'
                        onClick={() => moveSource(source.key, 1)}
                        disabled={index === sourceKeys.length - 1}
                        className='rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        aria-label={`降低 ${source.name} 的优先级`}
                      >
                        <ArrowDown className='h-4 w-4' />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className='mb-3 block text-sm font-medium text-gray-700 dark:text-gray-300'>
            可选影视源
          </label>
          {availableSources.length === 0 ? (
            <div className='rounded-lg border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              暂无可用影视源，请先在“源配置”中添加并启用影视源。
            </div>
          ) : (
            <div className='grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2'>
              {availableSources.map((source) => {
                const selected = sourceKeys.includes(source.key);
                return (
                  <label
                    key={source.key}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selected
                        ? 'border-primary-400 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                        : 'border-gray-200 bg-white hover:border-primary-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-700'
                    }`}
                  >
                    <input
                      type='checkbox'
                      checked={selected}
                      onChange={() => toggleSource(source.key)}
                      className='h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500'
                    />
                    <div className='min-w-0'>
                      <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {source.name}
                      </div>
                      <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                        {getSourceHost(source.api)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className='flex flex-wrap gap-3'>
        <button
          type='button'
          onClick={handleSave}
          disabled={isLoading}
          className='flex items-center rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-400'
        >
          <svg
            className='mr-2 h-4 w-4'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M5 13l4 4L19 7'
            />
          </svg>
          {isLoading ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );
};

export default ShortDramaConfig;
