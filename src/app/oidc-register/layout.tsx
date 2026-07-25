import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
};

export default function OidcRegisterLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
