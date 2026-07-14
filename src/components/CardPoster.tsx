'use client';

import Image from 'next/image';
import { memo, startTransition, useCallback, useState } from 'react';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';

const LIVE_FALLBACK =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect fill="%23374151" width="200" height="300"/%3E%3Cg fill="%239CA3AF"%3E%3Ccircle cx="100" cy="120" r="30"/%3E%3Cpath d="M60 160 Q60 140 80 140 L120 140 Q140 140 140 160 L140 200 Q140 220 120 220 L80 220 Q60 220 60 200 Z"/%3E%3C/g%3E%3Ctext x="100" y="260" font-family="Arial" font-size="14" fill="%239CA3AF" text-anchor="middle"%3E%E7%9B%B4%E6%92%AD%E9%A2%91%E9%81%93%3C/text%3E%3C/svg%3E';

export const POSTER_FALLBACK =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect fill="%23374151" width="200" height="300"/%3E%3Cg fill="%239CA3AF"%3E%3Cpath d="M100 80 L100 120 M80 100 L120 100" stroke="%239CA3AF" stroke-width="8" stroke-linecap="round"/%3E%3Crect x="60" y="140" width="80" height="100" rx="5" fill="none" stroke="%239CA3AF" stroke-width="4"/%3E%3Cpath d="M70 160 L90 180 L130 140" stroke="%239CA3AF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/%3E%3C/g%3E%3Ctext x="100" y="270" font-family="Arial" font-size="12" fill="%239CA3AF" text-anchor="middle"%3E%E6%9A%82%E6%97%A0%E6%B5%B7%E6%8A%A5%3C/text%3E%3C/svg%3E';

interface CardPosterProps {
  alt: string;
  origin: 'vod' | 'live';
  priority: boolean;
  src: string;
}

function CardPoster({ alt, origin, priority, src }: CardPosterProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  const markImageLoaded = useCallback(() => {
    startTransition(() => {
      setImageLoaded((loaded) => (loaded ? loaded : true));
    });
  }, []);

  return (
    <>
      <div
        className='pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:animate-[card-shimmer_2.5s_ease-in-out_infinite] motion-reduce:animate-none'
        style={{
          background:
            'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.15) 45%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.15) 55%, transparent 70%)',
          backgroundSize: '200% 100%',
        }}
      />

      {!imageLoaded && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}

      <Image
        src={src}
        alt={alt}
        fill
        sizes='(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw'
        className={`${origin === 'live' ? 'object-contain' : 'object-cover'} pointer-events-none select-none transition-all duration-500 ease-out ${
          imageLoaded
            ? 'scale-100 opacity-100 blur-0'
            : 'scale-105 opacity-0 blur-md'
        }`}
        referrerPolicy='no-referrer'
        loading={priority ? 'eager' : 'lazy'}
        decoding='async'
        fetchPriority={priority ? 'high' : undefined}
        quality={75}
        draggable={false}
        onLoad={markImageLoaded}
        onError={(event) => {
          event.currentTarget.src =
            origin === 'live' ? LIVE_FALLBACK : POSTER_FALLBACK;
          markImageLoaded();
        }}
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          pointerEvents: 'none',
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
      />
    </>
  );
}

export default memo(CardPoster);
