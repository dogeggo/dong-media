import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dong Media 播放页',
  description: 'Dong Media 站内播放页面，仅向已登录用户提供。',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function PlayLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
