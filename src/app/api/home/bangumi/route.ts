import { NextRequest, NextResponse } from 'next/server';

import {
  getCachedBangumiData,
  isBangumiCalendarData,
} from '@/lib/bangumi-server';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import {
  getShanghaiWeekday,
  selectBangumiItemsForWeekday,
} from '@/lib/home-recommendations';
import { authenticateRequest } from '@/lib/request-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: noStoreResponseHeaders() },
    );
  }

  try {
    const cached = await getCachedBangumiData('calendar');
    if (!isBangumiCalendarData(cached.value)) {
      throw new TypeError('Bangumi calendar response is invalid');
    }
    const weekday = getShanghaiWeekday();
    return NextResponse.json(
      {
        items: selectBangumiItemsForWeekday(cached.value, weekday),
        weekday,
      },
      {
        headers: noStoreResponseHeaders({
          'Server-Timing': `cache;desc="${cached.status}"`,
          'X-Cache-Status': cached.status,
        }),
      },
    );
  } catch (error) {
    console.error('Home Bangumi projection failed:', error);
    return NextResponse.json(
      { error: '获取今日新番失败' },
      { status: 502, headers: noStoreResponseHeaders() },
    );
  }
}
