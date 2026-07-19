'use client';

import { useState } from 'react';
import { Reveal, RisingWords } from '../_components/motion';

/**
 * "See it work" demo. There's no dashboard in the real product — everything
 * happens over text — so the most honest demo is a phone showing that exact
 * conversation. Visitors tap a request and watch the real graphic come back.
 * The images here are produced by the SAME engine that runs in production.
 */

type Sample = {
  file: string;
  ask: string; // what the owner texts
  reply: string; // what AISSM texts back
  brand: string;
};

const SAMPLES: Sample[] = [
  {
    file: 'promo.jpg',
    ask: 'make a promo for 50% off all lattes this Friday',
    reply: 'On it — here’s your Friday latte promo. Want me to schedule it for 8am?',
    brand: "Rosa's Coffee",
  },
  {
    file: 'quote.jpg',
    ask: 'a quote card: the best ideas are brewed, not forced',
    reply: 'Love this one. Here’s a clean quote card in your colors.',
    brand: "Rosa's Coffee",
  },
  {
    file: 'title.jpg',
    ask: 'a graphic for our spring bouquet launch',
    reply: 'Spring is in the air 🌷 Here’s your launch graphic.',
    brand: 'Bloom & Stem',
  },
  {
    file: 'cta.jpg',
    ask: 'a come-visit-us post with our hours',
    reply: 'Done — a warm “come say hi” post with your hours.',
    brand: 'Bloom & Stem',
  },
];

type Phase = 'idle' | 'sent' | 'typing' | 'done';

export default function DemoPage() {
  const [active, setActive] = useState<Sample>(SAMPLES[0]);
  const [phase, setPhase] = useState<Phase>('done');

  function run(sample: Sample) {
    setActive(sample);
    setPhase('sent');
    // Show the owner's text, then a typing indicator, then the graphic.
    window.setTimeout(() => setPhase('typing'), 500);
    window.setTimeout(() => setPhase('done'), 1900);
  }

  return (
    <main className="overflow-x-clip bg-warm-radial">
      <div className="mx-auto max-w-6xl px-6 pb-28 pt-14 sm:pt-20">
        <div className="max-w-2xl">
          <p className="eyebrow mb-6 animate-fade-in">
            ✳ Live sample — no sign-up
          </p>
          <h1 className="font-display text-[clamp(2.6rem,7vw,4.2rem)] font-semibold leading-[1.02] tracking-tight">
            <RisingWords text="Text a request." />{' '}
            <span className="wonk italic text-clay-600">
              <RisingWords text="Get a post." startDelay={240} />
            </span>
          </h1>
          <p
            className="mt-6 max-w-xl animate-fade-in text-lg leading-relaxed text-ink/70"
            style={{ animationDelay: '600ms' }}
          >
            This is the whole product. You send a plain-English text; we send
            back a finished, on-brand graphic. Tap one below to watch it happen
            — these are real graphics from our engine, not mockups.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[1fr_360px]">
          {/* Prompt chooser */}
          <Reveal className="order-2 lg:order-1">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50">
              Try one of these
            </h2>
            <div className="mt-5 flex flex-col gap-3">
              {SAMPLES.map((s) => {
                const on = s.file === active.file;
                return (
                  <button
                    key={s.file}
                    onClick={() => run(s)}
                    className={`group rounded-3xl border px-6 py-4 text-left transition-all duration-300 ease-out ${
                      on
                        ? 'border-clay-500/60 bg-white shadow-lift'
                        : 'border-ink/10 bg-white/70 hover:border-clay-300 hover:bg-white hover:shadow-soft'
                    }`}
                  >
                    <span className="block text-[15px] font-medium text-ink">
                      “{s.ask}”
                    </span>
                    <span className="mt-1.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-ink/45">
                      {s.brand}
                      {on && <span className="ml-2 text-clay-500">— playing</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-7 max-w-md text-sm leading-relaxed text-ink/55">
              In the real thing you can also just describe what’s going on this
              week and we’ll come up with the ideas for you.
            </p>
          </Reveal>

          {/* Phone mockup */}
          <Reveal delay={150} className="order-1 mx-auto lg:order-2">
            <div className="relative">
              <div
                aria-hidden
                className="absolute -inset-8 -z-10 rounded-full bg-clay-200/40 blur-3xl"
              />
              <div className="w-[320px] overflow-hidden rounded-[2.4rem] border border-ink/10 bg-paper shadow-lift">
                {/* status bar */}
                <div className="flex items-center justify-between bg-ink px-6 py-2.5 font-mono text-[10px] tracking-wider text-paper/70">
                  <span>9:41</span>
                  <span className="font-sans text-[11px] font-medium tracking-normal text-paper">
                    AISSM ✳
                  </span>
                  <span>•••</span>
                </div>

                <div className="flex h-[560px] flex-col gap-3 overflow-y-auto bg-parchment/50 px-4 py-5">
                  {/* owner's message */}
                  <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-sm text-white shadow-soft">
                    {active.ask}
                  </div>

                  {/* typing indicator */}
                  {phase === 'typing' && (
                    <div className="self-start rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-soft">
                      <span className="flex gap-1">
                        <Dot d="0ms" />
                        <Dot d="150ms" />
                        <Dot d="300ms" />
                      </span>
                    </div>
                  )}

                  {/* reply + graphic */}
                  {phase === 'done' && (
                    <>
                      <div className="max-w-[85%] animate-fade-in self-start rounded-2xl rounded-bl-md bg-white px-4 py-2.5 text-sm text-ink shadow-soft">
                        {active.reply}
                      </div>
                      <div
                        className="w-[85%] animate-fade-in self-start overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-soft"
                        style={{ animationDelay: '200ms' }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/samples/${active.file}`}
                          alt={active.ask}
                          className="w-full"
                        />
                      </div>
                      <div
                        className="animate-fade-in self-end rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-sm text-white shadow-soft"
                        style={{ animationDelay: '900ms' }}
                      >
                        love it 👍
                      </div>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink/50">
                Tap a request to replay
              </p>
            </div>
          </Reveal>
        </div>

        {/* CTA */}
        <Reveal>
          <div className="relative mt-24 overflow-hidden rounded-4xl bg-ink px-8 py-16 text-center text-paper sm:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[32rem] -translate-x-1/2 rounded-full bg-clay-500/25 blur-3xl"
            />
            <h2 className="mx-auto max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              This is what shows up in your messages{' '}
              <span className="italic text-clay-300">every week.</span>
            </h2>
            <a href="/billing" className="btn-clay mt-9">
              See plans
              <span aria-hidden className="btn-arrow">
                →
              </span>
            </a>
          </div>
        </Reveal>
      </div>
    </main>
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
