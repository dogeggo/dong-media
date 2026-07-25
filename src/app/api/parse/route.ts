import { NextRequest, NextResponse } from 'next/server';

import { authenticateRequest } from '@/lib/request-auth';
import { parseSafeHttpUrl } from '@/lib/safe-upstream-url';

interface Parser {
  name: string;
  url: string;
  platforms: string[];
  priority: number;
}

const PARSERS: Parser[] = [
  {
    name: 'M3U8.TV解析',
    url: 'https://jx.m3u8.tv/jiexi/?url=',
    platforms: ['qq', 'iqiyi', 'youku', 'mgtv', 'bilibili', 'pptv'],
    priority: 1,
  },
  {
    name: '星空解析',
    url: 'https://jx.xmflv.com/?url=',
    platforms: ['qq', 'iqiyi', 'youku', 'mgtv', 'bilibili'],
    priority: 2,
  },
  {
    name: '播放家解析',
    url: 'https://jx.playerjy.com/?url=',
    platforms: ['qq', 'iqiyi', 'youku', 'sohu', 'letv'],
    priority: 3,
  },
  {
    name: '爱豆解析',
    url: 'https://jx.aidouer.net/?url=',
    platforms: ['qq', 'iqiyi', 'youku', 'bilibili', 'mgtv'],
    priority: 4,
  },
  {
    name: '77FLV解析',
    url: 'https://jx.77flv.cc/?url=',
    platforms: ['qq', 'iqiyi', 'youku', 'mgtv', 'bilibili'],
    priority: 5,
  },
];

const PLATFORM_HOSTS: Record<string, readonly string[]> = {
  qq: ['qq.com'],
  iqiyi: ['iqiyi.com', 'qiyi.com'],
  youku: ['youku.com'],
  mgtv: ['mgtv.com'],
  bilibili: ['bilibili.com'],
  sohu: ['sohu.com'],
  letv: ['letv.com', 'le.com'],
  pptv: ['pptv.com'],
};

function detectPlatform(url: URL): string | null {
  return (
    Object.entries(PLATFORM_HOSTS).find(([, hosts]) =>
      hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      ),
    )?.[0] || null
  );
}

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export async function GET(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: responseHeaders },
    );
  }

  const url = request.nextUrl.searchParams.get('url');
  const requestedParser = request.nextUrl.searchParams.get('parser');
  const format = request.nextUrl.searchParams.get('format') || 'json';

  if (!url) {
    return NextResponse.json(
      { error: '缺少必需参数: url' },
      { status: 400, headers: responseHeaders },
    );
  }
  if (format !== 'json') {
    return NextResponse.json(
      { error: '仅支持安全的 JSON 返回格式' },
      { status: 400, headers: responseHeaders },
    );
  }

  let originalUrl: URL;
  try {
    originalUrl = parseSafeHttpUrl(url);
  } catch {
    return NextResponse.json(
      { error: '视频地址无效' },
      { status: 400, headers: responseHeaders },
    );
  }

  const platform = detectPlatform(originalUrl);
  if (!platform) {
    return NextResponse.json(
      { error: '该视频平台不受支持' },
      { status: 400, headers: responseHeaders },
    );
  }

  const availableParsers = PARSERS.filter((parser) =>
    parser.platforms.includes(platform),
  ).sort((a, b) => a.priority - b.priority);
  const selectedParser = requestedParser
    ? availableParsers.find((parser) => parser.name === requestedParser)
    : availableParsers[0];

  if (!selectedParser) {
    return NextResponse.json(
      { error: '指定解析器不存在或不支持该平台' },
      { status: 400, headers: responseHeaders },
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        original_url: originalUrl.toString(),
        platform,
        parse_url:
          selectedParser.url + encodeURIComponent(originalUrl.toString()),
        parser_name: selectedParser.name,
        available_parsers: availableParsers.map((parser) => parser.name),
      },
    },
    { headers: responseHeaders },
  );
}
