import type { Metadata } from 'next';
import { Fraunces, Instrument_Sans, Space_Mono } from 'next/font/google';
import './globals.css';
import { SiteHeader, SiteFooter } from './_components/chrome';
import { Analytics } from '@vercel/analytics/react';

/**
 * Type system: Fraunces (a warm, characterful serif with optical sizing and a
 * subtle "wonk" axis) for display; Instrument Sans for body; Space Mono for
 * the typed-transcript labels that run through the whole identity.
 */
const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT', 'WONK'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://texthandled.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Handled — Your social media, handled',
  description:
    'We write and design your social media — swipeable carousels, posts, captions — and you approve it by text. An agency charges $1,500 a month for the same work.',
  openGraph: {
    title: 'Handled — Your social media, handled',
    description:
      'We write and design your social media — swipeable carousels, posts, captions — and you approve it by text. An agency charges $1,500 a month for the same work.',
    url: siteUrl,
    siteName: 'Handled',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Handled — Your social media, handled',
    description:
      'We design and post your social media — carousels included — and you approve it by text.',
  },
  icons: {
    apple: '/apple-touch-icon.png',
    other: [{ rel: 'icon', url: '/icon-512.png', sizes: '512x512' }],
  },
  // Self-referencing canonical on every page, resolved against metadataBase —
  // keeps the old vercel.app URLs from competing with texthandled.com in search.
  alternates: { canonical: './' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="flex min-h-screen flex-col font-sans">
        {/* If JS is off, reveal everything immediately */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important;filter:none !important}`}</style>
        </noscript>
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
