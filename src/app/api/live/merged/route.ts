import { NextRequest, NextResponse } from 'next/server';

import { noStoreResponseHeaders } from '@/lib/cache-system';
import { getCachedLiveChannels } from '@/lib/live';
import { createSignedMediaProxyUrl } from '@/lib/media-signature';
import { authenticateRequest } from '@/lib/request-auth';
import { parseSafeHttpUrl } from '@/lib/safe-upstream-url';
import { getSiteOrigin } from '@/lib/site-origin';

export const runtime = 'nodejs';

function cleanM3uText(value: string) {
  return value.replace(/[\r\n]/g, ' ').trim();
}

function cleanM3uAttribute(value: string) {
  return cleanM3uText(value).replace(/["\\]/g, '');
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = getSiteOrigin(request);
  const format = request.nextUrl.searchParams.get('format') || 'm3u';
  if (format !== 'm3u' && format !== 'epg') {
    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  }
  const lines = ['#EXTM3U'];
  const xmlChannels: string[] = [];
  const xmlPrograms: string[] = [];
  const enabledLives = (auth.config.LiveConfig || []).filter(
    (live) => !live.disabled,
  );

  for (const live of enabledLives) {
    const liveChannels = await getCachedLiveChannels(live.key);
    if (!liveChannels) continue;

    for (const channel of liveChannels.channels) {
      try {
        const epgKey = channel.tvgId || channel.name;
        const publicEpgId = `${live.key}:${epgKey}`;

        if (format === 'epg') {
          const logo = liveChannels.epgLogos?.[epgKey] || channel.logo;
          xmlChannels.push(
            `<channel id="${escapeXml(publicEpgId)}"><display-name>${escapeXml(channel.name)}</display-name>${logo ? `<icon src="${escapeXml(logo)}"/>` : ''}</channel>`,
          );
          for (const program of liveChannels.epgs[epgKey] || []) {
            xmlPrograms.push(
              `<programme start="${escapeXml(program.start)}" stop="${escapeXml(program.end)}" channel="${escapeXml(publicEpgId)}"><title>${escapeXml(program.title)}</title></programme>`,
            );
          }
          continue;
        }

        const targetUrl = parseSafeHttpUrl(channel.url).toString();
        const proxyUrl = createSignedMediaProxyUrl({
          origin,
          scope: 'm3u8',
          source: live.key,
          targetUrl,
        });
        lines.push(
          `#EXTINF:-1 tvg-id="${cleanM3uAttribute(publicEpgId)}" tvg-logo="${cleanM3uAttribute(channel.logo)}" group-title="${cleanM3uAttribute(channel.group || live.name)}",${cleanM3uText(channel.name)}`,
        );
        lines.push(proxyUrl);
      } catch {
        // Skip malformed or unsafe channel URLs without exposing them.
      }
    }
  }

  if (format === 'epg') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><tv generator-info-name="Dong Media">${xmlChannels.join('')}${xmlPrograms.join('')}</tv>`;
    return new NextResponse(xml, {
      headers: noStoreResponseHeaders({
        'Content-Type': 'application/xml; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      }),
    });
  }

  return new NextResponse(`${lines.join('\n')}\n`, {
    headers: noStoreResponseHeaders({
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Content-Disposition': 'inline; filename="dong-media-live.m3u"',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    }),
  });
}
