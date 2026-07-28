export default function SkeletonCard() {
  return (
    <div className='w-24 min-w-[96px] sm:w-44 sm:min-w-[180px]'>
      {/* 海报骨架 */}
      <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
        <div
          className='absolute inset-0 -translate-x-full animate-shimmer bg-linear-to-r from-transparent via-white/20 to-transparent motion-reduce:animate-none'
          style={{
            animationDuration: '1.5s',
            animationIterationCount: 'infinite',
          }}
        />
      </div>

      <div className='mt-2 space-y-2'>
        <div className='h-4 rounded bg-gray-200 dark:bg-gray-800' />
        <div className='h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
      </div>
    </div>
  );
}
