import { after, NextRequest, NextResponse } from 'next/server';

import { noStoreResponseHeaders } from '@/lib/cache-system';
import {
  getShanghaiDate,
  selectHomeUpcomingReleases,
} from '@/lib/home-recommendations';
import {
  readCachedReleaseCalendar,
  warmReleaseCalendarCache,
} from '@/lib/release-calendar-cache';
import { authenticateRequest } from '@/lib/request-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: noStoreResponseHeaders() },
    );
  }

  const cached = await readCachedReleaseCalendar();
  if (!cached) {
    after(() =>
      warmReleaseCalendarCache().catch((error) => {
        console.error('Release calendar background warm failed:', error);
      }),
    );
    return NextResponse.json(
      { items: [], refreshing: true },
      {
        status: 202,
        headers: noStoreResponseHeaders({
          'Retry-After': '3',
          'X-Cache-Status': 'MISS',
        }),
      },
    );
  }

  if (cached.status === 'STALE') {
    after(() =>
      warmReleaseCalendarCache().catch((error) => {
        console.error('Release calendar background refresh failed:', error);
      }),
    );
  }

  return NextResponse.json(
    {
      items: selectHomeUpcomingReleases(cached.value.items, getShanghaiDate()),
      refreshing: cached.status === 'STALE',
    },
    {
      headers: noStoreResponseHeaders({
        'Server-Timing': `cache;desc="${cached.status}"`,
        'X-Cache-Status': cached.status,
      }),
    },
  );
}
