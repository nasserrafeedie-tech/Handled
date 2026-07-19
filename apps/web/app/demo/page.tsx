'use client';

import { useState } from 'react';

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
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="max-w-2xl">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-clay-200 bg-white/70 px-3 py-1 text-xs font-medium text-clay-700">
          <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />
          Live sample — no sign-up
        </p>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Text a request. <span className="italic text-clay-600">Get a post.</span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink/70">
          This is the whole product. You send a plain-English text; we send back a
          finished, on-brand graphic. Tap one below to watch it happen — these are
          real graphics from our engine, not mockups.
        </p>
      </div>

      <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1fr_360px]">
        {/* Prompt chooser */}
        <div className="order-2 lg:order-1">
          <h2 className="font-display text-lg font-medium text-ink/80">
            Try one of these
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            {SAMPLES.map((s) => {
              const on = s.file === active.file;
              return (
                <button
                  key={s.file}
                  onClick={() => run(s)}
                  className={`rounded-3xl border px-5 py-4 text-left transition ${
                    on
                      ? 'border-clay-300 bg-clay-50 shadow-soft'
                      : 'border-clay-100 bg-white hover:border-clay-200'
                  }`}
                >
                  <span className="block text-sm font-medium text-ink">
                    “{s.ask}”
                  </span>
                  <span className="mt-1 block text-xs text-ink/50">{s.brand}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-6 text-sm text-ink/50">
            In the real thing you can also just describe what’s going on this week
            and we’ll come up with the ideas for you.
          </p>
        </div>

        {/* Phone mockup */}
        <div className="order-1 mx-auto lg:order-2">
          <div className="w-[320px] overflow-hidden rounded-[2.5rem] border-[10px] border-ink bg-paper shadow-soft">
            {/* status bar */}
            <div className="flex items-center justify-between bg-ink px-6 py-2 text-[11px] text-paper/80">
              <span>9:41</span>
              <span className="font-medium text-paper">AISSM</span>
              <span>•••</span>
            </div>

            <div className="flex h-[560px] flex-col gap-3 overflow-y-auto bg-clay-50/40 px-4 py-5">
              {/* owner's message */}
              <div className="self-end max-w-[80%] rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-sm text-white shadow-soft">
                {active.ask}
              </div>

              {/* typing indicator */}
              {phase === 'typing' && (
                <div className="self-start rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-soft">
                  <span className="flex gap-1">
                    <Dot /> <Dot /> <Dot />
                  </span>
                </div>
              )}

              {/* reply + graphic */}
              {phase === 'done' && (
                <>
                  <div className="self-start max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-2.5 text-sm text-ink shadow-soft">
                    {active.reply}
                  </div>
                  <div className="self-start w-[85%] overflow-hidden rounded-2xl border border-clay-100 bg-white shadow-soft">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/samples/${active.file}`}
                      alt={active.ask}
                      className="w-full"
                    />
                  </div>
                  <div className="self-end max-w-[80%] rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-sm text-white shadow-soft">
                    love it 👍
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-ink/40">
            Tap a request to replay the conversation
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-20 rounded-4xl bg-ink px-8 py-12 text-center text-paper sm:px-16">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          This is what shows up in your messages every week.
        </h2>
        <a
          href="/billing"
          className="mt-7 inline-block rounded-full bg-clay-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-clay-400"
        >
          See plans
        </a>
      </div>
    </main>
  );
}

function Dot() {
  return <span className="h-2 w-2 animate-bounce rounded-full bg-ink/30" />;
}
