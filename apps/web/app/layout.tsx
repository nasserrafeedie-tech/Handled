import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
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

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-clay-100/70 bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-clay-500 text-sm text-white">
            A
          </span>
          AISSM
        </a>
        <nav className="hidden items-center gap-7 text-sm text-ink/70 sm:flex">
          <a className="hover:text-ink" href="/#how">
            How it works
          </a>
          <a className="hover:text-ink" href="/demo">
            See it work
          </a>
          <a className="hover:text-ink" href="/billing">
            Pricing
          </a>
          <a className="hover:text-ink" href="/about">
            About
          </a>
          <a className="hover:text-ink" href="/connect">
            Connect
          </a>
        </nav>
        <a
          href="/billing"
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-600"
        >
          Get started
        </a>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-clay-100 bg-clay-50/50">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-ink/60 sm:flex-row">
        <span className="font-display italic">
          AISSM — your social media, handled.
        </span>
        <nav className="flex items-center gap-5">
          <a className="hover:text-ink" href="/">
            Home
          </a>
          <a className="hover:text-ink" href="/billing">
            Pricing
          </a>
          <a className="hover:text-ink" href="/about">
            About
          </a>
          <a className="hover:text-ink" href="/privacy">
            Privacy
          </a>
          <a className="hover:text-ink" href="/terms">
            Terms
          </a>
        </nav>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
