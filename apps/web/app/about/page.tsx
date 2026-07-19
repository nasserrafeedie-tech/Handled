import type { Metadata } from 'next';
import { FOUNDER_NAME, FOUNDER_ROLE, FOUNDER_NOTE } from '../_lib/founder';
import { Reveal, RisingWords } from '../_components/motion';

export const metadata: Metadata = {
  title: 'About — AISSM',
  description:
    'Why AISSM exists: giving small businesses the calm, done-for-you social media presence that used to be reserved for companies with a marketing budget.',
};

const BELIEFS = [
  {
    n: '01',
    title: 'Small businesses deserve big-business polish',
    body: 'A great café or salon shouldn’t look worse online than a chain with a marketing team. We close that gap without the agency price tag.',
  },
  {
    n: '02',
    title: 'Software should feel like a person',
    body: 'No dashboards, no logins, no “onboarding.” You text us like you’d text a capable friend, and things just get handled.',
  },
  {
    n: '03',
    title: 'You stay in control',
    body: 'Nothing goes out that you haven’t okayed — until you decide you trust us enough to run parts of it on autopilot. Trust is earned, not assumed.',
  },
  {
    n: '04',
    title: 'Honest work, honestly priced',
    body: 'No contracts, no lock-in, no surprise fees. If we’re not earning our keep, you cancel with a single text.',
  },
];

export default function AboutPage() {
  return (
    <main className="overflow-x-clip">
      {/* Intro */}
      <section className="bg-warm-radial">
        <div className="mx-auto max-w-4xl px-6 pb-20 pt-14 sm:pt-20">
          <p className="eyebrow mb-6 animate-fade-in">✳ About us</p>
          <h1 className="font-display text-[clamp(2.6rem,7vw,4.5rem)] font-semibold leading-[1.02] tracking-tight">
            <RisingWords text="The marketing department small businesses" />
            <br />
            <span className="wonk italic text-clay-600">
              <RisingWords text="can finally afford." startDelay={420} />
            </span>
          </h1>
          <p
            className="mt-8 max-w-2xl animate-fade-in text-lg leading-relaxed text-ink/70"
            style={{ animationDelay: '800ms' }}
          >
            AISSM plans, writes, designs, and publishes social media for local
            businesses — almost entirely on its own, and entirely over text. We
            built it for the owners who are brilliant at what they do and simply
            don’t have another ten hours a week to spend fighting with
            Instagram.
          </p>
        </div>
      </section>

      {/* The letter */}
      <section className="border-y border-ink/10 bg-parchment/70">
        <div className="mx-auto grid max-w-5xl items-start gap-12 px-6 py-24 md:grid-cols-[280px_1fr] md:gap-16">
          <Reveal>
            <div className="mx-auto w-56 md:mx-0 md:w-full">
              <div className="-rotate-2 overflow-hidden rounded-3xl border border-ink/10 bg-white p-3 pb-12 shadow-lift transition-transform duration-500 ease-out hover:rotate-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/founder.jpg"
                  alt={`${FOUNDER_NAME}, ${FOUNDER_ROLE} of AISSM`}
                  className="aspect-[3/4] w-full rounded-xl object-cover"
                />
                <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink/50">
                  {FOUNDER_NAME} — {FOUNDER_ROLE}
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="relative rounded-3xl border border-ink/10 bg-paper p-8 shadow-soft sm:p-12">
              <p className="eyebrow">How it started</p>
              <div className="mt-8 flex flex-col gap-6 font-display text-xl leading-relaxed text-ink/85 sm:text-[1.35rem]">
                {FOUNDER_NOTE.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              <p className="mt-10 font-display text-2xl italic text-clay-600">
                — {FOUNDER_NAME}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Beliefs */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <Reveal>
          <p className="eyebrow">What we believe</p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Four things we won’t{' '}
            <span className="italic text-clay-600">budge on.</span>
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2">
          {BELIEFS.map((b, i) => (
            <Reveal key={b.n} delay={i * 110}>
              <div className="border-t-2 border-ink/15 pt-6 transition-colors duration-500 hover:border-clay-500">
                <span className="font-mono text-sm text-clay-500">{b.n}</span>
                <h3 className="mt-3 font-display text-2xl font-medium leading-snug">
                  {b.title}
                </h3>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink/65">
                  {b.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-4xl bg-ink px-8 py-16 text-center text-paper sm:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[32rem] -translate-x-1/2 rounded-full bg-clay-500/25 blur-3xl"
            />
            <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              Let’s take posting{' '}
              <span className="italic text-clay-300">off your plate.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-paper/60">
              Pick a plan and we’ll handle the rest — the whole thing runs in
              your messages.
            </p>
            <a href="/billing" className="btn-clay mt-9">
              See plans
              <span aria-hidden className="btn-arrow">
                →
              </span>
            </a>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
