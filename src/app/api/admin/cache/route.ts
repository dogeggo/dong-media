import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  ALL_CACHE_POLICIES,
  cacheService,
  getCachePolicy,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { imageDiskCache, videoDiskCache } from '@/lib/cache-system/media/disk';

export const runtime = 'nodejs';

const TYPE_TO_TAG: Record<string, string> = {
  douban: 'douban',
  shortdrama: 'shortdrama',
  tmdb: 'tmdb',
  danmu: 'danmu',
  netdisk: 'netdisk',
  youtube: 'youtube',
  search: 'search',
  live: 'live',
  media: 'media',
  config: 'config',
};

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreResponseHeaders(init?.headers),
  });
}

function authorize(request: NextRequest): Response | null {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authInfo.username !== process.env.USERNAME) {
    return json({ error: 'Forbidden: Owner access required' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const [stats, image, video] = await Promise.all([
      cacheService.stats(),
      imageDiskCache.stats(),
      videoDiskCache.stats(),
    ]);
    return json({ success: true, data: formatStats(stats, { image, video }) });
  } catch {
    return json({ success: false, error: '获取缓存统计失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;

  const type = request.nextUrl.searchParams.get('type');
  try {
    if (type === 'expired') {
      const localRemoved = cacheService.clearExpiredMemory();
      const [image, video] = await Promise.all([
        imageDiskCache.cleanup(),
        videoDiskCache.cleanup(),
      ]);
      const clearedCount = localRemoved + image.removed + video.removed;
      return json({
        success: true,
        data: {
          clearedCount,
          message: `已清理 ${localRemoved} 个过期 L1 条目和 ${image.removed + video.removed} 个过期/损坏媒体对象；共享缓存由 TTL 自动清理`,
          invalidations: [],
          media: { image, video },
        },
      });
    }

    const policy = type ? getCachePolicy(type) : undefined;
    const invalidations =
      type === 'all'
        ? await cacheService.invalidateAll()
        : policy
          ? [await cacheService.invalidateNamespace(policy)]
          : type && TYPE_TO_TAG[type]
            ? await cacheService.invalidateTag(TYPE_TO_TAG[type])
            : null;

    if (!invalidations) {
      return json({ success: false, error: '无效的缓存类型' }, { status: 400 });
    }

    const clearedCount = invalidations.reduce(
      (total, result) => total + result.localEntriesRemoved,
      0,
    );
    const clearMedia =
      type === 'all' ||
      type === 'media' ||
      invalidations.some((item) => item.namespace.startsWith('media.'));
    const media = clearMedia
      ? await Promise.all([imageDiskCache.clear(), videoDiskCache.clear()])
      : [0, 0];
    const mediaRemoved = media[0] + media[1];
    return json({
      success: true,
      data: {
        clearedCount: clearedCount + mediaRemoved,
        message: `已切换 ${invalidations.length} 个缓存命名空间的 generation，移除 ${clearedCount} 个 L1 条目和 ${mediaRemoved} 个磁盘媒体对象`,
        invalidations,
        media: { image: media[0], video: media[1] },
      },
    });
  } catch {
    return json({ success: false, error: '清理缓存失败' }, { status: 500 });
  }
}

function formatStats(
  stats: Awaited<ReturnType<typeof cacheService.stats>>,
  media: {
    image: Awaited<ReturnType<typeof imageDiskCache.stats>>;
    video: Awaited<ReturnType<typeof videoDiskCache.stats>>;
  },
) {
  const l1 = stats.layers.find((layer) => layer.layer === 'L1');
  const l2 = stats.layers.find((layer) => layer.layer === 'L2');
  const namespaces = mergeNamespaceStats(
    l1?.byNamespace || {},
    l2?.byNamespace || {},
  );

  const groups = Object.fromEntries(
    [
      'douban',
      'shortdrama',
      'tmdb',
      'danmu',
      'netdisk',
      'youtube',
      'search',
    ].map((group) => [group, groupStats(group, namespaces)]),
  ) as Record<
    string,
    { count: number; size: number; types: Record<string, number> }
  >;
  const knownNamespaces = new Set(
    Object.keys(namespaces).filter((namespace) =>
      Object.keys(groups).some(
        (group) => namespace === group || namespace.startsWith(`${group}.`),
      ),
    ),
  );
  const other = Object.entries(namespaces).reduce(
    (result, [namespace, value]) => {
      if (!knownNamespaces.has(namespace)) {
        result.count += value.entries;
        result.size += value.estimatedBytes;
      }
      return result;
    },
    { count: 0, size: 0 },
  );
  const total = {
    count:
      (l1?.entries || 0) +
      (l2?.entries || 0) +
      media.image.entries +
      media.video.entries,
    size:
      (l1?.estimatedBytes || 0) +
      (l2?.estimatedBytes || 0) +
      media.image.bytes +
      media.video.bytes,
  };

  const namespaceDetails = ALL_CACHE_POLICIES.map((policy) => {
    const metric = stats.namespaces.find(
      (item) => item.namespace === policy.namespace,
    );
    const l1Stats = l1?.byNamespace?.[policy.namespace];
    const l2Stats = l2?.byNamespace?.[policy.namespace];
    const disk =
      policy.namespace === 'media.image'
        ? media.image
        : policy.namespace === 'media.video'
          ? media.video
          : undefined;
    return {
      policy,
      metrics: metric,
      layers: {
        L1: l1Stats || { entries: 0, estimatedBytes: 0 },
        L2: l2Stats || { entries: 0, estimatedBytes: 0 },
        ...(disk
          ? { DISK: { entries: disk.entries, estimatedBytes: disk.bytes } }
          : {}),
      },
    };
  });

  return {
    ...groups,
    other,
    total,
    timestamp: new Date().toISOString(),
    source: 'all-layers',
    formattedSizes: {
      ...Object.fromEntries(
        Object.entries(groups).map(([name, value]) => [
          name,
          formatBytes(value.size),
        ]),
      ),
      other: formatBytes(other.size),
      total: formatBytes(total.size),
    },
    namespaces: stats.namespaces,
    layers: stats.layers,
    policies: ALL_CACHE_POLICIES,
    namespaceDetails,
    media,
  };
}

function mergeNamespaceStats(
  ...layers: Array<Record<string, { entries: number; estimatedBytes: number }>>
) {
  const merged: Record<string, { entries: number; estimatedBytes: number }> =
    {};
  for (const layer of layers) {
    for (const [namespace, value] of Object.entries(layer)) {
      const target = (merged[namespace] ||= { entries: 0, estimatedBytes: 0 });
      target.entries += value.entries;
      target.estimatedBytes += value.estimatedBytes;
    }
  }
  return merged;
}

function groupStats(
  group: string,
  namespaces: Record<string, { entries: number; estimatedBytes: number }>,
) {
  const result = { count: 0, size: 0, types: {} as Record<string, number> };
  for (const [namespace, value] of Object.entries(namespaces)) {
    if (namespace !== group && !namespace.startsWith(`${group}.`)) continue;
    result.count += value.entries;
    result.size += value.estimatedBytes;
    result.types[namespace.slice(group.length + 1) || group] = value.entries;
  }
  return result;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}
