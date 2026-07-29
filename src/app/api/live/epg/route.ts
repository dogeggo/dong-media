import { NextRequest, NextResponse } from 'next/server';

import {
  CACHE_POLICIES,
  cacheService,
  noStoreResponseHeaders,
} from '@/lib/cache-system';
import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');
    const tvgId = searchParams.get('tvgId');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    if (!tvgId) {
      return NextResponse.json(
        { error: '缺少频道tvg-id参数' },
        { status: 400 },
      );
    }

    const channelData = await cacheService.getOrLoad(
      CACHE_POLICIES.LIVE_EPG,
      { sourceKey },
      async () => {
        const channels = await getCachedLiveChannels(sourceKey);
        if (!channels) return null;
        return {
          epgUrl: channels.epgUrl,
          epgs: channels.epgs,
          epgLogos: channels.epgLogos,
        };
      },
      { isNegative: (value) => value === null },
    );

    if (!channelData) {
      // 频道信息未找到时返回空的节目单数据
      return NextResponse.json(
        {
          success: true,
          data: {
            tvgId,
            source: sourceKey,
            epgUrl: '',
            programs: [],
          },
        },
        { headers: noStoreResponseHeaders() },
      );
    }

    // 从epgs字段中获取对应tvgId的节目单信息
    const epgData = channelData.epgs[tvgId] || [];
    const logoUrl = channelData.epgLogos?.[tvgId] || '';

    return NextResponse.json(
      {
        success: true,
        data: {
          tvgId,
          source: sourceKey,
          epgUrl: channelData.epgUrl,
          logo: logoUrl,
          programs: epgData,
        },
      },
      { headers: noStoreResponseHeaders() },
    );
  } catch (_error) {
    return NextResponse.json(
      { error: '获取节目单信息失败' },
      { status: 500, headers: noStoreResponseHeaders() },
    );
  }
}
