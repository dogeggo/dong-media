'use client';

import { useEffect } from 'react';

import { initCacheCleaner } from '@/lib/cache';

export default function CacheCleaner() {
  useEffect(() => {
    initCacheCleaner();
  }, []);

  return null;
}
