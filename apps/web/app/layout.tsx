import type { Metadata } from 'next';
import { Fraunces, Instrument_Sans, Space_Mono } from 'next/font/google';
import './globals.css';
import { SiteHeader, SiteFooter } from './_components/chrome';

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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aissm-web.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'AISSM — Your social media, handled',
  description:
    'Done-for-you social media for small businesses, run entirely over text. The calm alternative to a $1,500/mo agency.',
  openGraph: {
    title: 'AISSM — Your social media, handled',
    description:
      'Done-for-you social media for small businesses, run entirely over text. The calm alternative to a $1,500/mo agency.',
    url: siteUrl,
    siteName: 'AISSM',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AISSM — Your social media, handled',
    description:
      'Done-for-you social media for small businesses, run entirely over text.',
  },
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
      </body>
    </html>
  );
}
