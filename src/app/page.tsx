import { Suspense } from 'react';

import { getInitialHomeRecommendations } from '@/lib/home-server';

import HomeClient from '@/components/home/HomeClient';
import PageLayout from '@/components/PageLayout';

function HomeLoading() {
  return (
    <PageLayout>
      <div className='overflow-visible sm:pd-45 sm:pb-0 md:pb-safe-bottom'>
        <div className='mb-8 flex items-center justify-center'>
          <div
            aria-hidden='true'
            className='h-10 w-44 rounded-full bg-gray-100 dark:bg-gray-900'
          />
        </div>
        <section className='mb-10 sm:mb-8'>
          <div
            aria-label='首页推荐加载中'
            className='h-[50vh] w-full rounded-xl bg-gray-100/70 motion-safe:animate-pulse dark:bg-gray-900/40 sm:h-[55vh] md:h-[60vh]'
            role='status'
          />
        </section>
      </div>
    </PageLayout>
  );
}

export default function Home() {
  const recommendations = getInitialHomeRecommendations();

  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeClient recommendations={recommendations} />
    </Suspense>
  );
}
