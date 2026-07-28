'use client';

import { DeferredUserMenu } from './DeferredUserMenu';
import ModernNav from './ModernNav';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  const { siteName } = useSite();

  // 2025 Modern Navigation Layout
  return (
    <>
      <div className='w-full min-h-screen'>
        {/* Modern Navigation - Top (Desktop) & Bottom (Mobile) */}
        <ModernNav />

        {/* 移动端头部 - Logo和用户菜单 */}
        <div className='md:hidden fixed top-0 left-0 right-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-sm'>
          <div className='flex items-center justify-between h-11 px-4'>
            {/* Logo */}
            <div className='text-base font-bold bg-linear-to-r from-primary-600 via-emerald-600 to-teal-600 dark:from-primary-400 dark:via-emerald-400 dark:to-teal-400 bg-clip-text text-transparent'>
              {siteName}
            </div>

            {/* Theme Toggle & User Menu */}
            <div className='w-[88px]' aria-hidden='true' />
          </div>
        </div>

        {/* 全端共用一组操作，避免 CSS 隐藏的重复组件仍执行副作用。 */}
        <div className='fixed top-0 right-4 z-50 flex h-11 items-center gap-1.5 md:right-6 md:h-14 lg:right-12 xl:right-16 2xl:right-20'>
          <ThemeToggle />
          <DeferredUserMenu />
        </div>

        {/* Main Content - 移动端44px顶部 + 底部导航栏空间,桌面端64px */}
        <main className='w-full min-h-screen pt-0 md:pt-10 pb-24 md:pb-0'>
          <div className='w-full max-w-640 mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20'>
            {children}
          </div>
        </main>
      </div>
    </>
  );
};

export default PageLayout;
