import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dong Media',
  description: 'Dong Media 私有站点访问入口，仅用于本站账户认证。',
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
  referrer: 'no-referrer',
};

export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
