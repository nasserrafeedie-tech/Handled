'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero's proof: a phone that runs the actual product on loop. An owner's
 * request types itself out, AISSM "thinks", and a real graphic (rendered by
 * the production engine) arrives. Then the next request begins.
 *
 * Honest by construction — the images are the same files the engine produced
 * for the samples row below.
 */

interface Exchange {
  ask: string;
  reply: string;
  img: string;
}

const EXCHANGES: Exchange[] = [
  {
    ask: 'post about our fresh croissants this morning',
    reply: 'On it — here’s a draft for 8am ☕',
    img: '/samples/promo.jpg',
  },
  {
    ask: 'something for the spring bouquet launch',
    reply: 'Spring it is 🌷 how’s this?',
    img: '/samples/title.jpg',
  },
  {
    ask: 'a quote card — best ideas are brewed, not forced',
    reply: 'Love that line. Draft below.',
    img: '/samples/quote.jpg',
  },
  {
    ask: 'a come-visit-us post with our hours',
    reply: 'Done — warm and simple.',
    img: '/samples/cta.jpg',
  },
];

type Stage = 'typing' | 'thinking' | 'delivered';

export function HeroPhone() {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const [stage, setStage] = useState<Stage>('typing');
  const timers = useRef<number[]>([]);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  useEffect(() => {
    const ex = EXCHANGES[i];
    const t = timers.current;
    t.forEach(clearTimeout);
    t.length = 0;

    if (reduced.current) {
      // No typewriter for reduced motion — just show completed exchanges.
      setTyped(ex.ask);
      setStage('delivered');
      t.push(window.setTimeout(() => setI((n) => (n + 1) % EXCHANGES.length), 6000));
      return () => t.forEach(clearTimeout);
    }

    setTyped('');
    setStage('typing');

    // Type the owner's message character by character.
    ex.ask.split('').forEach((_, c) => {
      t.push(
        window.setTimeout(() => setTyped(ex.ask.slice(0, c + 1)), 350 + c * 34),
      );
    });
    const doneTyping = 350 + ex.ask.length * 34;
    t.push(window.setTimeout(() => setStage('thinking'), doneTyping + 450));
    t.push(window.setTimeout(() => setStage('delivered'), doneTyping + 1900));
    t.push(
      window.setTimeout(
        () => setI((n) => (n + 1) % EXCHANGES.length),
        doneTyping + 6400,
      ),
    );

    return () => t.forEach(clearTimeout);
  }, [i]);

  const ex = EXCHANGES[i];

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      {/* Ambient glow behind the phone */}
      <div
        aria-hidden
        className="absolute -inset-8 -z-10 rounded-full bg-clay-200/40 blur-3xl"
      />

      <div className="overflow-hidden rounded-[2.4rem] border border-ink/10 bg-paper shadow-lift">
        {/* Status bar */}
        <div className="flex items-center justify-between bg-ink px-6 py-2.5 font-mono text-[10px] tracking-wider text-paper/70">
          <span>9:14</span>
          <span className="font-sans text-[11px] font-medium tracking-normal text-paper">
            AISSM ✳
          </span>
          <span>•••</span>
        </div>

        {/* Conversation */}
        <div className="flex h-[430px] flex-col gap-3 overflow-hidden bg-parchment/50 px-4 py-5">
          {/* Owner types */}
          <div className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-sm leading-snug text-white shadow-soft">
            {typed}
            {stage === 'typing' && (
              <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-white/90" />
            )}
          </div>

          {/* AISSM thinking */}
          {stage === 'thinking' && (
            <div className="self-start rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-soft">
              <span className="flex gap-1">
                <Dot d="0ms" />
                <Dot d="150ms" />
                <Dot d="300ms" />
              </span>
            </div>
          )}

          {/* Delivery */}
          {stage === 'delivered' && (
            <>
              <div className="max-w-[85%] animate-fade-in self-start rounded-2xl rounded-bl-md bg-white px-4 py-2.5 text-sm leading-snug text-ink shadow-soft">
                {ex.reply}
              </div>
              <div
                className="w-[78%] animate-fade-in self-start overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-soft"
                style={{ animationDelay: '250ms' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ex.img}
                  alt={`Generated post: ${ex.ask}`}
                  className="aspect-square w-full object-cover"
                />
              </div>
              <div
                className="animate-fade-in self-end rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-sm text-white shadow-soft"
                style={{ animationDelay: '1400ms' }}
              >
                love it 👍
              </div>
            </>
          )}
        </div>
      </div>

      {/* Caption */}
      <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink/50">
        Actual engine output — on loop
      </p>
    </div>
  );
}

function Dot({ d }: { d: string }) {
  return (
    <span
      className="h-2 w-2 animate-dot-pulse rounded-full bg-ink/40"
      style={{ animationDelay: d }}
    />
  );
}
