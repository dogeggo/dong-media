/* eslint-disable no-console */

'use client';

import { ChevronUp, Filter, Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getShortDramaCategories,
  getShortDramaList,
  searchShortDramas,
} from '@/lib/shortdrama-client';
import { ShortDramaCategory, ShortDramaItem } from '@/lib/types';

import PageLayout from '@/components/PageLayout';

// 🚀 性能优化：使用动态导入延迟加载重型组件，显著提升导航响应速度
const ShortDramaCard = dynamic(() => import('@/components/ShortDramaCard'), {
  ssr: false,
});

export default function ShortDramaPage() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const [categories, setCategories] = useState<ShortDramaCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number>();
  const [dramas, setDramas] = useState<ShortDramaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 用于防止分类切换时的闪烁
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const observer = useRef<IntersectionObserver | undefined>(undefined);
  const lastDramaElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          if (isSearchMode && !hasUserScrolled) {
            return;
          }
          setPage((prevPage) => prevPage + 1);
        }
      });
      if (node) observer.current.observe(node);
    },
    [loading, hasMore, isSearchMode, hasUserScrolled],
  );

  // 获取分类列表
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const cats = await getShortDramaCategories();
        setCategories(cats);
        if (cats.length > 0 && !selectedCategory) {
          setSelectedCategory(cats[0].type_id);
        }
      } catch (error) {
        console.error('加载短剧分类失败:', error);
        const fallbackCategories = [{ type_id: 1, type_name: '全部短剧' }];
        setCategories(fallbackCategories);
        setSelectedCategory(1);
      }
    };
    fetchCategories();
  }, []);

  // 监听滚动位置，控制返回顶部按钮显示 - 🚀 性能优化: 移除 RAF 无限循环
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollTop = document.body.scrollTop || 0;
          setShowBackToTop(scrollTop > 300);
          if (!hasUserScrolled && scrollTop > 0) {
            setHasUserScrolled(true);
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, [hasUserScrolled]);

  // 加载短剧列表
  const loadDramas = useCallback(
    async (pageNum: number, reset = false) => {
      setLoading(true);
      setLoadError(null);
      try {
        let result: { list: ShortDramaItem[]; hasMore: boolean };
        if (isSearchMode) {
          if (!searchQuery) {
            return;
          }
          result = await searchShortDramas(searchQuery, pageNum);
        } else {
          const categoryName = categories.find(
            (category) => category.type_id === selectedCategory,
          )?.type_name;
          result = await getShortDramaList(
            selectedCategory,
            pageNum,
            categoryName,
          );
        }

        if (reset) {
          setDramas(result.list);
          setIsInitialLoad(false);
        } else {
          setDramas((prev) => [...prev, ...result.list]);
        }
        setHasMore(result.hasMore);
      } catch (error) {
        console.error('加载短剧失败:', error);
        setLoadError(
          error instanceof Error
            ? error.message
            : '短剧数据加载失败，请稍后重试',
        );
        if (reset) {
          setDramas([]);
          setIsInitialLoad(false);
        }
      } finally {
        setLoading(false);
      }
    },
    [categories, selectedCategory, searchQuery, isSearchMode],
  );

  // 当分类变化时重新加载
  useEffect(() => {
    if (selectedCategory && !isSearchMode) {
      setPage(1);
      setHasMore(true);
      loadDramas(1, true);
    }
  }, [selectedCategory, isSearchMode, loadDramas]);

  // 当搜索条件变化时重新加载（统一走 loadDramas）
  useEffect(() => {
    if (isSearchMode && searchQuery) {
      setPage(1);
      setHasMore(true);
      loadDramas(1, true);
    }
  }, [isSearchMode, searchQuery, loadDramas]);

  // 当页码变化时加载更多
  useEffect(() => {
    if (page > 1) {
      loadDramas(page, false);
    }
  }, [page, loadDramas]);

  // 处理搜索
  const handleSearch = useCallback((rawQuery: string, clearResults = false) => {
    const normalized = rawQuery.trim();
    if (clearResults) {
      setDramas([]);
    }
    setSearchInput(normalized);
    setSearchQuery(normalized);
    setIsSearchMode(!!normalized);
    setPage(1);
    setHasMore(true);
    setHasUserScrolled(false);
    // 如果清空搜索，不需要手动调用 loadDramas
    // useEffect 会自动监听 isSearchMode 的变化并重新加载
  }, []);

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (_error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  if (!isMounted) {
    return (
      <PageLayout activePath='/shortdrama'>
        <div className='flex items-center justify-center min-h-[50vh]'>
          <div className='flex flex-col items-center gap-4'>
            <div className='w-12 h-12 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin' />
            <p className='text-gray-500 dark:text-gray-400 animate-pulse'>
              正在进入短剧频道...
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }

  const showSkeletons = loading && !isSearchMode && (isInitialLoad || page > 1);
  const isSearching = loading && isSearchMode;
  const isLoadingMore = loading && page > 1;
  const skeletonCount = 12;

  return (
    <PageLayout activePath='/shortdrama'>
      <div className='min-h-screen -mt-6 -md:mt-0 pb-0'>
        <div className=''>
          {/* 页面标题 */}
          <div className='mb-6'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-white'>
              短剧频道
            </h1>
            <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
              精彩短剧，一刷到底
            </p>
          </div>

          {/* 搜索栏 */}
          <div className='mb-6'>
            <div className='relative group'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-all duration-300 group-focus-within:text-purple-500 dark:group-focus-within:text-purple-400 group-focus-within:scale-110' />
              <input
                type='text'
                placeholder='搜索短剧名称...'
                className='w-full rounded-xl border border-gray-200 bg-white/80 pl-11 pr-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent focus:bg-white shadow-sm hover:shadow-md focus:shadow-lg dark:bg-gray-800/80 dark:text-white dark:placeholder-gray-500 dark:border-gray-700 dark:focus:bg-gray-800 dark:focus:ring-purple-500 transition-all duration-300'
                value={searchInput}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setSearchInput(nextValue);
                  if (
                    nextValue.trim() === '' &&
                    (isSearchMode || searchQuery)
                  ) {
                    handleSearch('');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch(searchInput, searchInput.trim() !== '');
                  }
                }}
              />
            </div>
          </div>

          {/* 搜索加载态：使用加载中样式 */}
          {isSearching && (
            <div className='flex justify-center mt-4 mb-2'>
              <div className='relative px-6 py-3 rounded-2xl bg-linear-to-r from-purple-50 via-pink-50 to-rose-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-rose-900/20 border border-purple-200/50 dark:border-purple-700/50 shadow-lg backdrop-blur-sm overflow-hidden'>
                {/* 动画背景 */}
                <div className='absolute inset-0 bg-linear-to-r from-purple-400/10 via-pink-400/10 to-rose-400/10 animate-pulse'></div>

                {/* 内容 */}
                <div className='relative flex items-center gap-3'>
                  {/* 旋转圈 */}
                  <div className='relative'>
                    <div className='animate-spin rounded-full h-6 w-6 border-[3px] border-purple-200 dark:border-purple-800'></div>
                    <div className='absolute inset-0 animate-spin rounded-full h-6 w-6 border-[3px] border-transparent border-t-purple-500 dark:border-t-purple-400'></div>
                  </div>

                  {/* 文字和点动画 */}
                  <div className='flex items-center gap-1'>
                    <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                      搜索中
                    </span>
                    <span className='flex gap-0.5'>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '0ms' }}
                      >
                        .
                      </span>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '150ms' }}
                      >
                        .
                      </span>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '300ms' }}
                      >
                        .
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 分类筛选 */}
          {!isSearchMode && categories.length > 0 && (
            <div className='mb-6'>
              <div className='flex items-center space-x-2.5 mb-4'>
                <div className='w-9 h-9 rounded-xl bg-linear-to-br from-purple-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30'>
                  <Filter className='h-4 w-4 text-white' />
                </div>
                <span className='text-base font-bold text-gray-900 dark:text-gray-100'>
                  分类筛选
                </span>
                <div className='flex-1'></div>
                <span className='text-xs px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium'>
                  {categories.length} 个分类
                </span>
              </div>
              <div className='flex flex-wrap gap-2.5'>
                {categories.map((category, index) => (
                  <button
                    key={category.type_id}
                    onClick={() => setSelectedCategory(category.type_id)}
                    className={`group relative overflow-hidden rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
                      selectedCategory === category.type_id
                        ? 'bg-linear-to-r from-purple-500 via-purple-600 to-pink-500 text-white shadow-lg shadow-purple-500/40'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 hover:shadow-md'
                    }`}
                    style={{
                      animation: `fadeInUp 0.3s ease-out ${index * 0.03}s both`,
                    }}
                  >
                    {/* 激活状态的光泽效果 */}
                    {selectedCategory === category.type_id && (
                      <div className='absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700'></div>
                    )}

                    {/* 未激活状态的悬停背景 */}
                    {selectedCategory !== category.type_id && (
                      <div className='absolute inset-0 bg-linear-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-purple-900/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300'></div>
                    )}

                    <span className='relative z-10'>{category.type_name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 短剧网格 */}
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'>
            {dramas.map((drama, index) => (
              <div
                key={`${drama.id}-${index}`}
                ref={index === dramas.length - 1 ? lastDramaElementRef : null}
              >
                <ShortDramaCard drama={drama} />
              </div>
            ))}
            {showSkeletons &&
              Array.from({ length: skeletonCount }).map((_, index) => (
                <div
                  key={`skeleton-${index}`}
                  className='relative overflow-hidden'
                >
                  <div className='aspect-[2/3] w-full rounded-lg bg-linear-to-br from-gray-100 via-gray-200 to-gray-100 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800'>
                    <div className='absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/20 to-transparent'></div>
                  </div>
                  <div className='mt-2 h-4 rounded bg-linear-to-r from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 relative overflow-hidden'>
                    <div className='absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/20 to-transparent'></div>
                  </div>
                  <div className='mt-1 h-3 w-2/3 rounded bg-linear-to-r from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 relative overflow-hidden'>
                    <div className='absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/20 to-transparent'></div>
                  </div>
                </div>
              ))}
          </div>

          {!loading && loadError && (
            <div className='flex justify-center py-12'>
              <div className='w-full max-w-lg rounded-2xl border border-red-200 bg-red-50/80 p-6 text-center shadow-sm dark:border-red-900/60 dark:bg-red-950/30'>
                <h3 className='text-lg font-semibold text-red-700 dark:text-red-300'>
                  短剧数据加载失败
                </h3>
                <p className='mt-2 text-sm text-red-600 dark:text-red-400'>
                  {loadError}
                </p>
                <button
                  type='button'
                  onClick={() => loadDramas(1, true)}
                  className='mt-5 rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700'
                >
                  重新加载
                </button>
              </div>
            </div>
          )}

          {/* 下拉加载更多提示 - 参考豆瓣页面样式 */}
          {isLoadingMore && hasMore && (
            <div className='flex justify-center mt-8 py-6'>
              <div className='relative px-8 py-4 rounded-2xl bg-linear-to-r from-purple-50 via-pink-50 to-rose-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-rose-900/20 border border-purple-200/50 dark:border-purple-700/50 shadow-lg backdrop-blur-sm overflow-hidden'>
                {/* 动画背景 */}
                <div className='absolute inset-0 bg-linear-to-r from-purple-400/10 via-pink-400/10 to-rose-400/10 animate-pulse'></div>

                {/* 内容 */}
                <div className='relative flex items-center gap-3'>
                  {/* 旋转圈 */}
                  <div className='relative'>
                    <div className='animate-spin rounded-full h-8 w-8 border-[3px] border-purple-200 dark:border-purple-800'></div>
                    <div className='absolute inset-0 animate-spin rounded-full h-8 w-8 border-[3px] border-transparent border-t-purple-500 dark:border-t-purple-400'></div>
                  </div>

                  {/* 文字和点动画 */}
                  <div className='flex items-center gap-1'>
                    <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                      加载中
                    </span>
                    <span className='flex gap-0.5'>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '0ms' }}
                      >
                        .
                      </span>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '150ms' }}
                      >
                        .
                      </span>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '300ms' }}
                      >
                        .
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 无更多数据提示 */}
          {!loading && !hasMore && dramas.length > 0 && (
            <div className='flex justify-center mt-12 py-8'>
              <div className='relative px-8 py-5 rounded-2xl bg-linear-to-r from-purple-50 via-pink-50 to-rose-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-rose-900/20 border border-purple-200/50 dark:border-purple-700/50 shadow-lg backdrop-blur-sm overflow-hidden'>
                {/* 装饰性背景 */}
                <div className='absolute inset-0 bg-linear-to-br from-purple-100/20 to-pink-100/20 dark:from-purple-800/10 dark:to-pink-800/10'></div>

                {/* 内容 */}
                <div className='relative flex flex-col items-center gap-2'>
                  {/* 完成图标 */}
                  <div className='relative'>
                    <div className='w-12 h-12 rounded-full bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg'>
                      <svg
                        className='w-7 h-7 text-white'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2.5'
                          d='M5 13l4 4L19 7'
                        ></path>
                      </svg>
                    </div>
                    {/* 光圈效果 */}
                    <div className='absolute inset-0 rounded-full bg-purple-400/30 animate-ping'></div>
                  </div>

                  {/* 文字 */}
                  <div className='text-center'>
                    <p className='text-base font-semibold text-gray-800 dark:text-gray-200 mb-1'>
                      已经到底了～
                    </p>
                    <p className='text-xs text-gray-600 dark:text-gray-400'>
                      共 {dramas.length} 部短剧
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 无搜索结果 */}
          {!loading && !loadError && dramas.length === 0 && isSearchMode && (
            <div className='flex justify-center py-16'>
              <div className='relative px-12 py-10 rounded-3xl bg-linear-to-br from-gray-50 via-slate-50 to-gray-100 dark:from-gray-800/40 dark:via-slate-800/40 dark:to-gray-800/50 border border-gray-200/50 dark:border-gray-700/50 shadow-xl backdrop-blur-sm overflow-hidden max-w-md'>
                {/* 装饰性元素 */}
                <div className='absolute top-0 left-0 w-32 h-32 bg-linear-to-br from-purple-200/20 to-pink-200/20 rounded-full blur-3xl'></div>
                <div className='absolute bottom-0 right-0 w-32 h-32 bg-linear-to-br from-primary-200/20 to-teal-200/20 rounded-full blur-3xl'></div>

                {/* 内容 */}
                <div className='relative flex flex-col items-center gap-4'>
                  {/* 搜索图标 */}
                  <div className='relative'>
                    <div className='w-24 h-24 rounded-full bg-linear-to-br from-gray-100 to-slate-200 dark:from-gray-700 dark:to-slate-700 flex items-center justify-center shadow-lg'>
                      <svg
                        className='w-12 h-12 text-gray-400 dark:text-gray-500'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='1.5'
                          d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                        ></path>
                      </svg>
                    </div>
                    {/* 浮动小点装饰 */}
                    <div className='absolute -top-1 -right-1 w-3 h-3 bg-purple-400 rounded-full animate-ping'></div>
                    <div className='absolute -bottom-1 -left-1 w-2 h-2 bg-pink-400 rounded-full animate-pulse'></div>
                  </div>

                  {/* 文字内容 */}
                  <div className='text-center space-y-2'>
                    <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                      没有找到相关短剧
                    </h3>
                    <p className='text-sm text-gray-600 dark:text-gray-400 max-w-xs'>
                      换个关键词试试，或者浏览其他分类
                    </p>
                  </div>

                  {/* 按钮 */}
                  <button
                    onClick={() => handleSearch('')}
                    className='mt-2 px-6 py-2.5 bg-linear-to-r from-primary-500 to-purple-500 hover:from-primary-600 hover:to-purple-600 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all duration-300 hover:scale-105'
                  >
                    清除搜索条件
                  </button>

                  {/* 装饰线 */}
                  <div className='w-16 h-1 bg-linear-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600 rounded-full'></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-500 w-12 h-12 bg-purple-500/90 hover:bg-purple-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}
