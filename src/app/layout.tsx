import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies, headers } from 'next/headers';

import './globals.css';

import { loadConfig } from '@/lib/config';
import { serializeInlineJson } from '@/lib/inline-json';

import { DeferredDownloadPanel } from '../components/download/DeferredDownloadPanel';
import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import NavigationLoading from '../components/NavigationLoading';
import QueryProvider from '../components/QueryProvider';
import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { DownloadProvider } from '../contexts/DownloadContext';
import { NavigationLoadingProvider } from '../contexts/NavigationLoadingContext';

const inter = Inter({ subsets: ['latin'], preload: false });
export const dynamic = 'force-dynamic';

// 动态生成 metadata，支持配置更新后的标题变化
export async function generateMetadata(): Promise<Metadata> {
  // 🔥 调用 cookies() 强制动态渲染，防止 Docker 环境下的缓存问题
  await cookies();

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'Dong Media';
  if (storageType !== 'localstorage') {
    const config = await loadConfig();
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影视聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 🔥 调用 cookies() 强制动态渲染，防止 Docker 环境下的缓存问题
  await cookies();
  const nonce = (await headers()).get('x-nonce') || '';

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'Dong Media';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

  let fluidSearch = process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false';
  let customCategories = [] as {
    name: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  if (storageType !== 'localstorage') {
    const config = await loadConfig();
    siteName = config.SiteConfig.SiteName;
    announcement = config.SiteConfig.Announcement;

    customCategories = config.CustomCategories.filter(
      (category) => !category.disabled,
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    }));
    fluidSearch = config.SiteConfig.FluidSearch;
  }

  // 将运行时配置注入到全局 window 对象，供客户端在运行时读取
  const runtimeConfig = {
    STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    CUSTOM_CATEGORIES: customCategories,
    FLUID_SEARCH: fluidSearch,
  };

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover'
        />
        <link rel='apple-touch-icon' href='/icons/icon-192x192.png' />
        {/* 将配置序列化后直接写入脚本，浏览器端可通过 window.RUNTIME_CONFIG 获取 */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${serializeInlineJson(runtimeConfig)};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <NavigationLoadingProvider>
              <DownloadProvider>
                <SiteProvider siteName={siteName} announcement={announcement}>
                  {children}
                  <GlobalErrorIndicator />
                  <NavigationLoading />
                </SiteProvider>
                <DeferredDownloadPanel />
              </DownloadProvider>
            </NavigationLoadingProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
