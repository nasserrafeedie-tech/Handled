'use client';

import { useState } from 'react';

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * FAQ accordion. Height animates via the grid-rows 0fr→1fr trick — smooth
 * without measuring anything. The ＋ rotates into ✕ as it opens.
 */
export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number>(0);

  return (
    <dl className="divide-y divide-ink/10 border-y border-ink/10">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <dt>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? -1 : i)}
                className="group flex w-full items-baseline justify-between gap-6 py-6 text-left"
              >
                <span className="flex items-baseline gap-4">
                  <span className="font-mono text-xs text-clay-500">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-display text-xl font-medium text-ink transition-colors group-hover:text-clay-600">
                    {item.q}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`shrink-0 font-display text-xl text-clay-500 transition-transform duration-300 ease-out ${
                    isOpen ? 'rotate-45' : ''
                  }`}
                >
                  +
                </span>
              </button>
            </dt>
            <dd
              className={`grid transition-[grid-template-rows] duration-500 ease-out ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="overflow-hidden">
                <p className="max-w-xl pb-6 pl-8 text-[15px] leading-relaxed text-ink/65">
                  {item.a}
                </p>
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
