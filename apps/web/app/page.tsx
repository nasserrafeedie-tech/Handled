const STEPS = [
  {
    n: '01',
    title: 'Tell us about your business',
    body: 'A quick text conversation — what you do, your vibe, who you serve. No forms, no onboarding calls.',
  },
  {
    n: '02',
    title: 'We plan, write & design',
    body: 'Every week we draft your posts and make the graphics. You get a text to look them over.',
  },
  {
    n: '03',
    title: 'You reply “yes”',
    body: 'Approve with a word and we publish on schedule. Too busy? Let us post on autopilot once you trust us.',
  },
] as const;

const SAMPLES = [
  { file: 'promo.png', prompt: '“make a promo for 50% off all lattes this Friday”' },
  { file: 'quote.png', prompt: '“a quote card: the best ideas are brewed, not forced”' },
  { file: 'title.png', prompt: '“a graphic for our spring bouquet launch”' },
  { file: 'cta.png', prompt: '“a come-visit-us post with our hours”' },
] as const;

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="bg-warm-radial">
        <div className="mx-auto max-w-5xl px-6 pb-20 pt-16 sm:pt-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-clay-200 bg-white/70 px-3 py-1 text-xs font-medium text-clay-700">
            <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />
            Run entirely over text
          </p>
          <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Your social media,{' '}
            <span className="italic text-clay-600">handled.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/70">
            We plan, write, design, and publish your posts almost entirely on our
            own. You just reply to a text now and then. It’s the done-for-you
            calm of a $1,500/mo agency — without the agency.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="/billing"
              className="rounded-full bg-clay-500 px-6 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-clay-600"
            >
              See plans
            </a>
            <a
              href="/#how"
              className="rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink transition hover:border-ink/40"
            >
              How it works
            </a>
          </div>
          <p className="mt-5 text-sm text-ink/50">
            No dashboard to learn. No passwords to hand over. Cancel anytime.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Three steps. Then mostly silence.
        </h2>
        <p className="mt-3 max-w-lg text-ink/60">
          The whole point is that you stop thinking about it. Here’s all it takes.
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col">
              <span className="font-display text-2xl italic text-clay-400">
                {s.n}
              </span>
              <h3 className="mt-3 font-display text-xl font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink/65">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="border-y border-clay-100 bg-clay-50/40">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Real posts, spelled right.
              </h2>
              <p className="mt-3 max-w-lg text-ink/60">
                Crisp graphics and carousels made to match your brand — not
                blurry AI pictures with garbled text.
              </p>
            </div>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SAMPLES.map((s) => (
              <div
                key={s.file}
                className="group overflow-hidden rounded-4xl border border-clay-100 bg-white shadow-soft"
              >
                <div className="aspect-square overflow-hidden bg-clay-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/samples/${s.file}`}
                    alt={s.prompt}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="px-5 py-4 text-sm leading-relaxed text-ink/70">
                  {s.prompt}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Voice / trust */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="font-display text-2xl font-medium italic leading-relaxed text-ink sm:text-3xl">
          “I run a coffee shop, not a marketing department. I text them what’s
          going on and my Instagram just… stays alive.”
        </p>
        <p className="mt-6 text-sm text-ink/55">Rosa — neighborhood café owner</p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-4xl bg-ink px-8 py-14 text-center text-paper sm:px-16">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Ready to stop worrying about posting?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-paper/70">
            Pick a plan and we’ll take it from there — the rest happens in your
            messages.
          </p>
          <a
            href="/billing"
            className="mt-8 inline-block rounded-full bg-clay-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-clay-400"
          >
            Get started
          </a>
        </div>
      </section>
    </main>
  );
}
