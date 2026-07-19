'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Scroll-reveal wrapper. Children start slightly lowered, blurred and
 * transparent (see .reveal in globals.css) and ease into place the first time
 * they enter the viewport. `delay` staggers siblings.
 *
 * Motion etiquette: prefers-reduced-motion disables the whole effect in CSS,
 * and content is never hidden from crawlers — the base state is CSS-only.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // If IntersectionObserver is unavailable, just show everything.
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-revealed');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-revealed');
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -36px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Splits a headline into words that rise line-by-line out of a clipped
 * container on first paint. Used for hero headlines only — it's a loud effect.
 */
export function RisingWords({
  text,
  className = '',
  startDelay = 0,
}: {
  text: string;
  className?: string;
  startDelay?: number;
}) {
  const words = text.split(' ');
  return (
    <span className={className}>
      {words.map((word, i) => (
        <span key={i}>
          <span className="clip-line">
            <span
              className="inline-block animate-rise"
              style={{ animationDelay: `${startDelay + i * 70}ms` }}
            >
              {word}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </span>
  );
}
