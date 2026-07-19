import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — AISSM',
  description:
    'Why AISSM exists: giving small businesses the calm, done-for-you social media presence that used to be reserved for companies with a marketing budget.',
};

const BELIEFS = [
  {
    title: 'Small businesses deserve big-business polish',
    body: 'A great café or salon shouldn’t look worse online than a chain with a marketing team. We close that gap without the agency price tag.',
  },
  {
    title: 'Software should feel like a person',
    body: 'No dashboards, no logins, no “onboarding.” You text us like you’d text a capable friend, and things just get handled.',
  },
  {
    title: 'You stay in control',
    body: 'Nothing goes out that you haven’t okayed — until you decide you trust us enough to run parts of it on autopilot. Trust is earned, not assumed.',
  },
  {
    title: 'Honest work, honestly priced',
    body: 'No contracts, no lock-in, no surprise fees. If we’re not earning our keep, you cancel with a single text.',
  },
] as const;

export default function AboutPage() {
  return (
    <main>
      {/* Intro */}
      <section className="bg-warm-radial">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-16 sm:pt-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-clay-200 bg-white/70 px-3 py-1 text-xs font-medium text-clay-700">
            <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />
            About us
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            The marketing department small businesses{' '}
            <span className="italic text-clay-600">can’t afford to hire.</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink/70">
            AISSM plans, writes, designs, and publishes social media for local
            businesses — almost entirely on its own, and entirely over text. We
            built it for the owners who are brilliant at what they do and simply
            don’t have another ten hours a week to spend fighting with Instagram.
          </p>
        </div>
      </section>

      {/* Story + founder */}
      <section className="border-y border-clay-100 bg-clay-50/40">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-6 py-20 md:grid-cols-[260px_1fr] md:gap-14">
          <div className="mx-auto w-52 md:mx-0 md:w-full">
            <div className="overflow-hidden rounded-4xl border border-clay-100 bg-white shadow-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/founder.jpg"
                alt="Nasser, founder of AISSM"
                className="aspect-[3/4] w-full object-cover"
              />
            </div>
          </div>
          <div>
            <p className="font-display text-xs uppercase tracking-[0.18em] text-clay-500">
              How it started
            </p>
            <div className="mt-6 flex flex-col gap-4 text-lg leading-relaxed text-ink/80">
              <p>
                I kept watching people I admire — the baker two doors down, the
                florist who knows every regular by name — pour everything into
                their craft, then feel a little guilty every time their
                Instagram went quiet for a month.
              </p>
              <p>
                They didn’t need a fancier tool. They needed someone to just
                take it off their plate. So we built the quiet partner we wished
                existed: one you can text, that does the planning, writing, and
                design, and then gets out of your way so you can get back to the
                work you actually love.
              </p>
            </div>
            <p className="mt-8 text-sm text-ink/55">— Nasser, founder</p>
          </div>
        </div>
      </section>

      {/* Beliefs */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          What we believe
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {BELIEFS.map((b) => (
            <div
              key={b.title}
              className="rounded-4xl border border-clay-100 bg-white p-7 shadow-soft"
            >
              <h3 className="font-display text-xl font-medium text-ink">
                {b.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-4xl bg-ink px-8 py-14 text-center text-paper sm:px-16">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Let’s take posting off your plate.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-paper/70">
            Pick a plan and we’ll handle the rest — the whole thing runs in your
            messages.
          </p>
          <a
            href="/billing"
            className="mt-8 inline-block rounded-full bg-clay-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-clay-400"
          >
            See plans
          </a>
        </div>
      </section>
    </main>
  );
}
