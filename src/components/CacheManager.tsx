'use client';

import {
  ArrowPathIcon,
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

interface Policy {
  namespace: string;
  scope: 'public' | 'user' | 'system';
  freshTtlSeconds: number;
  staleTtlSeconds?: number;
  negativeTtlSeconds?: number;
  layers: string[];
  tags: string[];
}

interface NamespaceDetail {
  policy: Policy;
  metrics?: {
    hits: number;
    misses: number;
    staleHits: number;
    errors: number;
    writes: number;
    rejectedWrites: number;
    coalescedLoads: number;
  };
  layers: Record<string, { entries: number; estimatedBytes: number }>;
}

interface CacheStats {
  total: { count: number; size: number };
  formattedSizes: { total: string };
  timestamp: string;
  source: string;
  namespaceDetails: NamespaceDetail[];
  layers: Array<{
    layer: string;
    entries: number;
    estimatedBytes: number;
    expiredEntries?: number;
  }>;
  media: {
    image: { enabled: boolean; entries: number; bytes: number };
    video: { enabled: boolean; entries: number; bytes: number };
  };
}

export default function CacheManager() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/cache', { cache: 'no-store' });
      const result = (await response.json()) as {
        success: boolean;
        data?: CacheStats;
        error?: string;
      };
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || '获取缓存统计失败');
      }
      setStats(result.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '获取缓存统计失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const clearCache = async (type: string, label: string) => {
    if (!window.confirm(`确定要清理${label}吗？`)) return;
    setClearing(type);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/cache?type=${encodeURIComponent(type)}`,
        { method: 'DELETE', cache: 'no-store' },
      );
      const result = (await response.json()) as {
        success: boolean;
        data?: { message?: string };
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '清理缓存失败');
      }
      window.dispatchEvent(
        new CustomEvent('globalSuccess', {
          detail: { message: result.data?.message || '缓存已清理' },
        }),
      );
      await fetchStats();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清理缓存失败');
    } finally {
      setClearing(null);
    }
  };

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <ChartBarIcon className='h-6 w-6 text-primary-600' />
          <div>
            <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              统一缓存管理
            </h2>
            <p className='text-sm text-gray-500 dark:text-gray-400'>
              按 namespace 查看策略、层级和运行指标
            </p>
          </div>
        </div>
        <button
          type='button'
          onClick={() => void fetchStats()}
          disabled={loading}
          className='inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600'
        >
          <ArrowPathIcon
            className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          />
          刷新
        </button>
      </div>

      {error && (
        <div className='flex items-center rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200'>
          <ExclamationTriangleIcon className='mr-3 h-5 w-5' />
          {error}
        </div>
      )}

      {stats && (
        <>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <SummaryCard label='缓存对象' value={String(stats.total.count)} />
            <SummaryCard label='估算空间' value={stats.formattedSizes.total} />
            <SummaryCard
              label='命名空间'
              value={String(stats.namespaceDetails.length)}
            />
            <SummaryCard
              label='统计时间'
              value={new Date(stats.timestamp).toLocaleTimeString()}
            />
          </div>

          <div className='rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800'>
            <h3 className='mb-4 font-medium text-gray-900 dark:text-gray-100'>
              层级概览
            </h3>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              {stats.layers.map((layer) => (
                <LayerCard
                  key={layer.layer}
                  label={layer.layer}
                  entries={layer.entries}
                  bytes={layer.estimatedBytes}
                />
              ))}
              <LayerCard
                label='DISK · image'
                entries={stats.media.image.entries}
                bytes={stats.media.image.bytes}
                disabled={!stats.media.image.enabled}
              />
              <LayerCard
                label='DISK · video'
                entries={stats.media.video.entries}
                bytes={stats.media.video.bytes}
                disabled={!stats.media.video.enabled}
              />
            </div>
          </div>

          <div className='overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'>
            <div className='border-b border-gray-200 px-5 py-4 dark:border-gray-700'>
              <h3 className='font-medium text-gray-900 dark:text-gray-100'>
                策略命名空间
              </h3>
            </div>
            <div className='divide-y divide-gray-200 dark:divide-gray-700'>
              {stats.namespaceDetails.map((detail) => (
                <NamespaceRow
                  key={detail.policy.namespace}
                  detail={detail}
                  clearing={clearing === detail.policy.namespace}
                  onClear={() =>
                    void clearCache(
                      detail.policy.namespace,
                      ` ${detail.policy.namespace} 缓存`,
                    )
                  }
                />
              ))}
            </div>
          </div>

          <div className='flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 sm:flex-row dark:border-gray-700 dark:bg-gray-800'>
            <button
              type='button'
              onClick={() => void clearCache('expired', '过期和损坏缓存')}
              disabled={clearing !== null}
              className='inline-flex flex-1 items-center justify-center rounded-md border border-orange-300 px-4 py-2 text-sm text-orange-700 disabled:opacity-50 dark:border-orange-800 dark:text-orange-300'
            >
              <ClockIcon className='mr-2 h-4 w-4' />
              清理过期项
            </button>
            <button
              type='button'
              onClick={() => void clearCache('all', '全部业务和媒体缓存')}
              disabled={clearing !== null}
              className='inline-flex flex-1 items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50'
            >
              <TrashIcon className='mr-2 h-4 w-4' />
              清理全部缓存
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-lg bg-linear-to-r from-primary-500 to-primary-600 p-5 text-white'>
      <div className='text-2xl font-bold'>{value}</div>
      <div className='mt-1 text-sm text-primary-100'>{label}</div>
    </div>
  );
}

function LayerCard({
  label,
  entries,
  bytes,
  disabled = false,
}: {
  label: string;
  entries: number;
  bytes: number;
  disabled?: boolean;
}) {
  return (
    <div className='rounded-md bg-gray-50 p-3 dark:bg-gray-700/60'>
      <div className='text-sm font-medium text-gray-700 dark:text-gray-200'>
        {label}
      </div>
      <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
        {disabled ? '当前部署已旁路' : `${entries} 项 · ${formatBytes(bytes)}`}
      </div>
    </div>
  );
}

function NamespaceRow({
  detail,
  clearing,
  onClear,
}: {
  detail: NamespaceDetail;
  clearing: boolean;
  onClear: () => void;
}) {
  const { policy, metrics } = detail;
  const entries = Object.values(detail.layers).reduce(
    (total, layer) => total + layer.entries,
    0,
  );
  const bytes = Object.values(detail.layers).reduce(
    (total, layer) => total + layer.estimatedBytes,
    0,
  );
  const reads =
    (metrics?.hits || 0) + (metrics?.misses || 0) + (metrics?.staleHits || 0);
  const hitRate = reads
    ? Math.round(
        (((metrics?.hits || 0) + (metrics?.staleHits || 0)) / reads) * 100,
      )
    : 0;

  return (
    <div className='grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] lg:items-center'>
      <div>
        <div className='font-mono text-sm font-medium text-gray-900 dark:text-gray-100'>
          {policy.namespace}
        </div>
        <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          {policy.scope} · fresh {formatDuration(policy.freshTtlSeconds)}
          {policy.staleTtlSeconds
            ? ` · stale ${formatDuration(policy.staleTtlSeconds)}`
            : ''}
        </div>
      </div>
      <div className='text-xs text-gray-600 dark:text-gray-300'>
        <div>{policy.layers.join(' → ')}</div>
        <div className='mt-1'>
          {entries} 项 · {formatBytes(bytes)} · 命中率 {hitRate}% · 错误{' '}
          {metrics?.errors || 0} · 合并回源 {metrics?.coalescedLoads || 0}
        </div>
      </div>
      <button
        type='button'
        onClick={onClear}
        disabled={clearing}
        className='inline-flex items-center justify-center rounded-md border border-red-200 px-3 py-2 text-xs text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300'
      >
        {clearing ? (
          <ArrowPathIcon className='mr-1 h-4 w-4 animate-spin' />
        ) : (
          <TrashIcon className='mr-1 h-4 w-4' />
        )}
        失效
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 86_400) return `${seconds / 86_400}d`;
  if (seconds >= 3_600) return `${seconds / 3_600}h`;
  if (seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}
