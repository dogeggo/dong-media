import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Children,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import AnimatedCardGrid from '@/components/AnimatedCardGrid';

interface ScrollableRowProps {
  children: React.ReactNode;
  scrollDistance?: number;
  enableAnimation?: boolean;
  enableVirtualization?: boolean;
  virtualItemClassName?: string;
  virtualPlaceholderClassName?: string;
}

function ScrollableRow({
  children,
  scrollDistance = 1000,
  enableAnimation = false,
  enableVirtualization = false,
  virtualItemClassName = 'min-w-24 w-24 sm:min-w-45 sm:w-44',
  virtualPlaceholderClassName = 'aspect-[2/3] w-full',
}: ScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const checkScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollFrameRef = useRef<number | null>(null);
  const itemStrideRef = useRef(0);
  const firstItemOffsetRef = useRef(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 8 });
  const [focusedVirtualIndex, setFocusedVirtualIndex] = useState<number | null>(
    null,
  );
  const shouldVirtualize = enableVirtualization && !enableAnimation;

  // 使用 useMemo 缓存 children 数量，减少不必要的 effect 触发
  const childrenCount = useMemo(() => Children.count(children), [children]);

  const measureVirtualItems = useCallback(() => {
    const container = containerRef.current;
    if (!container || container.children.length === 0) return;

    const first = container.children[0] as HTMLElement;
    const second = container.children[1] as HTMLElement | undefined;
    firstItemOffsetRef.current = first.offsetLeft;
    itemStrideRef.current = second
      ? second.offsetLeft - first.offsetLeft
      : first.offsetWidth;
  }, []);

  const checkScroll = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      const { scrollWidth, clientWidth, scrollLeft } = container;

      // 计算是否需要左右滚动按钮
      const threshold = 1; // 容差值，避免浮点误差
      const canScrollRight =
        scrollWidth - (scrollLeft + clientWidth) > threshold;
      const canScrollLeft = scrollLeft > threshold;

      setShowRightScroll((prev) =>
        prev !== canScrollRight ? canScrollRight : prev,
      );
      setShowLeftScroll((prev) =>
        prev !== canScrollLeft ? canScrollLeft : prev,
      );

      if (shouldVirtualize && itemStrideRef.current > 0) {
        const overscan = 3;
        const relativeStart = Math.max(
          0,
          scrollLeft - firstItemOffsetRef.current,
        );
        const relativeEnd = Math.max(
          0,
          scrollLeft + clientWidth - firstItemOffsetRef.current,
        );
        const startIndexVisible = Math.floor(
          relativeStart / itemStrideRef.current,
        );
        const stopIndexVisible = Math.min(
          childrenCount - 1,
          Math.ceil(relativeEnd / itemStrideRef.current),
        );

        const start = Math.max(0, startIndexVisible - overscan);
        const end = Math.min(childrenCount, stopIndexVisible + overscan + 1);

        setVisibleRange((prev) => {
          if (prev.start !== start || prev.end !== end) {
            return { start, end };
          }
          return prev;
        });
      }
    }
  }, [shouldVirtualize, childrenCount]);

  const scheduleScrollCheck = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      checkScroll();
    });
  }, [checkScroll]);

  // 保留所有轻量槽位来维持准确滚动宽度，只挂载可见区域及 overscan 内的重型子组件。
  const visibleChildren = useMemo(() => {
    if (!shouldVirtualize) {
      return children;
    }

    const childArray = Children.toArray(children);
    return childArray.map((child, index) => {
      const isVisible =
        (index >= visibleRange.start && index < visibleRange.end) ||
        index === focusedVirtualIndex;
      const childKey = isValidElement(child) ? child.key : index;

      return (
        <div
          key={childKey ?? index}
          className={`flex-none ${virtualItemClassName}`}
          data-virtual-index={index}
          data-virtual-mounted={isVisible ? 'true' : 'false'}
        >
          {isVisible ? (
            child
          ) : (
            <div aria-hidden='true' className={virtualPlaceholderClassName} />
          )}
        </div>
      );
    });
  }, [
    children,
    focusedVirtualIndex,
    shouldVirtualize,
    virtualItemClassName,
    virtualPlaceholderClassName,
    visibleRange,
  ]);

  useEffect(() => {
    // 延迟检查，确保内容已完全渲染
    if (checkScrollTimeoutRef.current) {
      clearTimeout(checkScrollTimeoutRef.current);
      checkScrollTimeoutRef.current = null;
    }
    checkScrollTimeoutRef.current = setTimeout(() => {
      measureVirtualItems();
      checkScroll();
    }, 100);

    // 监听窗口大小变化（使用防抖）
    let resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        measureVirtualItems();
        checkScroll();
      }, 200);
    };

    window.addEventListener('resize', handleResize, { passive: true }); // 使用 passive 优化

    // 只在子元素超过20个时才使用 ResizeObserver（减少性能开销）
    let resizeObserver: ResizeObserver | null = null;
    if (childrenCount > 20) {
      resizeObserver = new ResizeObserver(() => {
        // 使用防抖来减少不必要的检查
        if (checkScrollTimeoutRef.current) {
          clearTimeout(checkScrollTimeoutRef.current);
          checkScrollTimeoutRef.current = null;
        }
        checkScrollTimeoutRef.current = setTimeout(() => {
          measureVirtualItems();
          checkScroll();
        }, 150);
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      if (checkScrollTimeoutRef.current) {
        clearTimeout(checkScrollTimeoutRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [childrenCount, checkScroll, measureVirtualItems]);

  const handleScrollRightClick = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: scrollDistance,
        behavior: 'smooth',
      });
    }
  }, [scrollDistance]);

  const handleScrollLeftClick = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: -scrollDistance,
        behavior: 'smooth',
      });
    }
  }, [scrollDistance]);

  return (
    <div
      className='relative'
      onMouseEnter={() => {
        setIsHovered(true);
        // 当鼠标进入时重新检查一次
        checkScroll();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={containerRef}
        className='flex space-x-6 overflow-x-auto scrollbar-hide pt-3 pb-12 sm:pt-4 sm:pb-14 px-4 sm:px-6'
        onScroll={scheduleScrollCheck}
        onFocusCapture={(event) => {
          if (!shouldVirtualize) return;

          const slot = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-virtual-index]',
          );
          if (!slot || !event.currentTarget.contains(slot)) return;

          const index = Number(slot.dataset.virtualIndex);
          if (Number.isInteger(index)) setFocusedVirtualIndex(index);
        }}
        onBlurCapture={(event) => {
          if (
            shouldVirtualize &&
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setFocusedVirtualIndex(null);
          }
        }}
        style={{
          WebkitOverflowScrolling: 'touch', // iOS 惯性滚动
        }}
      >
        {enableAnimation ? (
          <AnimatedCardGrid className='flex space-x-6'>
            {visibleChildren}
          </AnimatedCardGrid>
        ) : (
          visibleChildren
        )}
      </div>
      {showLeftScroll && (
        <div
          className={`hidden sm:flex absolute left-0 top-0 bottom-0 w-16 items-center justify-center z-600 transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'transparent',
            pointerEvents: 'none', // 允许点击穿透
          }}
        >
          <div
            className='absolute inset-0 flex items-center justify-center'
            style={{
              top: '40%',
              bottom: '60%',
              left: '-4.5rem',
              pointerEvents: isHovered ? 'auto' : 'none', // 隐藏时禁用pointer事件
            }}
          >
            <button
              onClick={handleScrollLeftClick}
              className='w-12 h-12 bg-white/95 rounded-full shadow-lg flex items-center justify-center hover:bg-white border border-gray-200 transition-transform hover:scale-105 dark:bg-gray-800/90 dark:hover:bg-gray-700 dark:border-gray-600'
            >
              <ChevronLeft className='w-6 h-6 text-gray-600 dark:text-gray-300' />
            </button>
          </div>
        </div>
      )}

      {showRightScroll && (
        <div
          className={`hidden sm:flex absolute right-0 top-0 bottom-0 w-16 items-center justify-center z-600 transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'transparent',
            pointerEvents: 'none', // 允许点击穿透
          }}
        >
          <div
            className='absolute inset-0 flex items-center justify-center'
            style={{
              top: '40%',
              bottom: '60%',
              right: '-4.5rem',
              pointerEvents: isHovered ? 'auto' : 'none', // 隐藏时禁用pointer事件
            }}
          >
            <button
              onClick={handleScrollRightClick}
              className='w-12 h-12 bg-white/95 rounded-full shadow-lg flex items-center justify-center hover:bg-white border border-gray-200 transition-transform hover:scale-105 dark:bg-gray-800/90 dark:hover:bg-gray-700 dark:border-gray-600'
            >
              <ChevronRight className='w-6 h-6 text-gray-600 dark:text-gray-300' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ScrollableRow);
