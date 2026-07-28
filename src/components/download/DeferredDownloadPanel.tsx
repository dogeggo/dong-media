'use client';

import dynamic from 'next/dynamic';

import { useDownload } from '@/contexts/DownloadContext';

const DownloadPanel = dynamic(
  () => import('./DownloadPanel').then((module) => module.DownloadPanel),
  { ssr: false },
);

export function DeferredDownloadPanel() {
  const { showDownloadPanel } = useDownload();

  return showDownloadPanel ? <DownloadPanel /> : null;
}
