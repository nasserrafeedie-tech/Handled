'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/#how', label: 'How it works' },
  { href: '/demo', label: 'See it work' },
  { href: '/billing', label: 'Pricing' },
  { href: '/about', label: 'About' },
] as const;

/**
 * Site header. Starts transparent over the hero, frosts and tightens once the
 * page scrolls. The wordmark's asterisk spins slowly — a small print-shop
 * flourish that rewards noticing.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-500 ease-out ${
        scrolled
          ? 'border-b border-ink/10 bg-paper/85 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between px-6 transition-all duration-500 ease-out ${
          scrolled ? 'py-3' : 'py-5'
        }`}
      >
        <a
          href="/"
          className="group flex items-baseline gap-1 font-display text-xl font-semibold tracking-tight"
        >
          AISSM
          <span
            aria-hidden
            className="inline-block text-clay-500 transition-transform duration-700 ease-out group-hover:rotate-180 motion-safe:animate-spin-slow"
          >
            ✳
          </span>
        </a>

        <nav className="hidden items-center gap-8 text-sm sm:flex">
          {NAV.map((item) => {
            const active =
              item.href !== '/#how' && pathname.startsWith(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                className={`link-draw ${
                  active ? 'text-ink' : 'text-ink/60 hover:text-ink'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <a href="/billing" className="btn-primary !px-5 !py-2.5">
          Get started
          <span aria-hidden className="btn-arrow">
            →
          </span>
        </a>
      </div>
    </header>
  );
}

/**
 * Footer as a closing editorial page: oversized wordmark, mono nav,
 * a typed sign-off.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-ink/10 bg-parchment/60">
      <div className="mx-auto max-w-6xl px-6 pb-10 pt-16">
        <div className="flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
          <div>
            <p
              aria-hidden
              className="select-none font-display text-[17vw] font-semibold leading-none tracking-tight text-ink/[0.08] sm:text-[8rem]"
            >
              AISSM<span className="text-clay-500/30">✳</span>
            </p>
            <p className="mt-2 font-display text-lg italic text-ink/70">
              Your social media, handled.
            </p>
          </div>

          <nav className="flex flex-col items-start gap-2 font-mono text-xs uppercase tracking-[0.18em] text-ink/55 sm:items-end">
            <a className="link-draw hover:text-ink" href="/">
              Home
            </a>
            <a className="link-draw hover:text-ink" href="/demo">
              See it work
            </a>
            <a className="link-draw hover:text-ink" href="/billing">
              Pricing
            </a>
            <a className="link-draw hover:text-ink" href="/about">
              About
            </a>
            <a className="link-draw hover:text-ink" href="/privacy">
              Privacy
            </a>
            <a className="link-draw hover:text-ink" href="/terms">
              Terms
            </a>
          </nav>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-ink/10 pt-6 font-mono text-[11px] text-ink/55 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} AISSM</span>
          <span>
            No dashboard. No passwords. Reply STOP any time.
          </span>
        </div>
      </div>
    </footer>
  );
}
