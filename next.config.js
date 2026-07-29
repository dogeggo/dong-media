/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

const enableStandalone =
  process.env.NODE_ENV === 'production' &&
  (process.platform !== 'win32' || process.env.NEXT_STANDALONE === 'true');

const nextConfig = {
  // 生产环境默认使用 standalone 模式（Vercel/Docker/Zeabur）
  // Windows 本地构建默认关闭，避免 symlink 权限错误，可通过 NEXT_STANDALONE=true 强制开启
  ...(enableStandalone ? { output: 'standalone' } : {}),

  reactStrictMode: false,

  // Next.js 16 使用 Turbopack，配置 SVG 加载
  turbopack: {
    root: __dirname,
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },

  // Uncoment to add domain whitelist
  images: {
    qualities: [75, 85, 100],
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  async headers() {
    const oneWeek = 'public, max-age=604800, s-maxage=604800';
    const staticMedia = [
      '/icons/:path*',
      '/media/:path*',
      '/images/:path*',
      '/videos/:path*',
      '/logo.png',
      '/favicon.ico',
    ].map((source) => ({
      source,
      headers: [{ key: 'Cache-Control', value: oneWeek }],
    }));
    const privateNoStore = [
      '/api',
      '/api/admin/:path*',
      '/api/auth/:path*',
      '/api/user/:path*',
      '/api/login',
      '/api/logout',
      '/api/register',
      '/api/cron',
      '/api/change-password',
      '/api/playrecords',
      '/api/favorites',
      '/api/favorites/:path*',
      '/api/searchhistory',
      '/api/skipconfigs',
      '/api/episode-skip-config',
      '/api/search',
      '/api/search/:path*',
      '/api/sources',
      '/api/parse',
      '/api/detail',
      '/api/live/:path*',
      '/api/source-browser/:path*',
      '/api/source-test',
      '/api/source-test/:path*',
      '/api/tvbox',
      '/api/tvbox/:path*',
      '/api/tvbox-config',
      '/api/proxy-status',
      '/api/proxy/:path*',
      '/api/netdisk/:path*',
      '/api/youtube/:path*',
      '/api/acg/:path*',
    ].map((source) => ({
      source,
      headers: [
        {
          key: 'Cache-Control',
          value: 'private, no-store, max-age=0',
        },
        { key: 'Pragma', value: 'no-cache' },
      ],
    }));
    return [...staticMedia, ...privateNoStore];
  },
};

module.exports = nextConfig;
