'use client';

import {
  type ReactNode,
  startTransition,
  useEffect,
  useRef,
  useState,
} from 'react';

interface DeferredSectionProps {
  children: ReactNode;
  className?: string;
  eager?: boolean;
  placeholderClassName?: string;
  rootMargin?: string;
}

/**
 * 延迟挂载视口外的重型 Section。
 *
 * 与 content-visibility 不同，这里在接近视口前不会创建子组件、Hook 和图片，
 * 但仍通过占位高度保持页面布局稳定。
 */
export default function DeferredSection({
  children,
  className = '',
  eager = false,
  placeholderClassName = 'min-h-[22rem] sm:min-h-[28rem]',
  rootMargin = '160px 0px',
}: DeferredSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(eager);

  useEffect(() => {
    if (shouldRender) return;

    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') {
      startTransition(() => setShouldRender(true));
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        observer.disconnect();
        startTransition(() => setShouldRender(true));
      },
      { rootMargin },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [rootMargin, shouldRender]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-deferred-section={shouldRender ? 'mounted' : 'placeholder'}
    >
      {shouldRender ? (
        children
      ) : (
        <div
          aria-hidden='true'
          className={`${placeholderClassName} w-full contain-layout`}
        />
      )}
    </div>
  );
}
