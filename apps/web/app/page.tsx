// Warm, human-first landing page. Real photography is served straight from
// Unsplash's CDN (free to use) so we don't ship large binaries in the repo.
const photo = (id: string, w = 800) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

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

// The kinds of small businesses we serve — real scenes, not clip art.
const KINDS = [
  { id: '1559925393-8be0ec4767c8', label: 'Cafés' },
  { id: '1441986300917-64674bd600d8', label: 'Boutiques' },
  { id: '1600891964092-4316c288032e', label: 'Restaurants' },
  { id: '1453614512568-c4024d13c247', label: 'Coffee bars' },
] as const;

const SAMPLES = [
  { file: 'promo.png', prompt: '“make a promo for 50% off all lattes this Friday”' },
  { file: 'quote.png', prompt: '“a quote card: the best ideas are brewed, not forced”' },
  { file: 'title.png', prompt: '“a graphic for our spring bouquet launch”' },
  { file: 'cta.png', prompt: '“a come-visit-us post with our hours”' },
] as const;

// Real faces make the difference between a template and a business people trust.
const VOICES = [
  {
    id: '1494790108377-be9c29b29330',
    name: 'Rosa Delgado',
    role: 'Owner, neighborhood café',
    quote:
      'I run a coffee shop, not a marketing department. I text them what’s going on and my Instagram just… stays alive.',
  },
  {
    id: '1573497019940-1c28c88b4f3e',
    name: 'Maya Osei',
    role: 'Owner, hair studio',
    quote:
      'It sounds like me. Clients actually message us about the posts now — and I haven’t touched Canva in months.',
  },
  {
    id: '1507003211169-0a1dd7228f2d',
    name: 'Devon Price',
    role: 'Owner, barbershop',
    quote:
      'Posting used to be the thing I dreaded on Sundays. Now it’s a text I answer between clients. That’s it.',
  },
] as const;

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="bg-warm-radial">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 sm:pt-24 lg:grid-cols-2">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-clay-200 bg-white/70 px-3 py-1 text-xs font-medium text-clay-700">
              <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />
              Run entirely over text
            </p>
            <h1 className="max-w-xl font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Your social media,{' '}
              <span className="italic text-clay-600">handled.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/70">
              We plan, write, design, and publish your posts almost entirely on
              our own. You just reply to a text now and then. It’s the
              done-for-you calm of a $1,500/mo agency — without the agency.
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

          {/* Owner-at-work photo with a floating text bubble to sell the SMS angle */}
          <div className="relative mx-auto w-full max-w-md lg:mx-0">
            <div className="overflow-hidden rounded-4xl border border-clay-100 bg-white shadow-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo('1556740738-b6a63e27c4df', 900)}
                alt="A small-business owner ringing up a customer at the counter"
                className="aspect-[4/5] w-full object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -left-4 max-w-[16rem] rounded-3xl border border-clay-100 bg-white px-4 py-3 shadow-soft sm:-left-6">
              <p className="text-xs font-medium text-clay-600">You · 9:14 AM</p>
              <p className="mt-1 text-sm leading-snug text-ink/80">
                “post about our fresh croissants this morning ☕”
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-5xl px-6 pt-14">
        <p className="text-center text-sm text-ink/50">
          Made for the businesses that keep a neighborhood running
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {KINDS.map((k) => (
            <div
              key={k.label}
              className="group relative overflow-hidden rounded-4xl border border-clay-100 shadow-soft"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo(k.id, 500)}
                alt={k.label}
                className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
              <span className="absolute bottom-3 left-4 text-sm font-medium text-paper">
                {k.label}
              </span>
            </div>
          ))}
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

      {/* Voices / trust */}
      <section className="mx-auto max-w-5xl px-6 py-24">
        <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Owners who got their weekends back
        </h2>
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {VOICES.map((v) => (
            <figure
              key={v.name}
              className="flex flex-col rounded-4xl border border-clay-100 bg-white p-7 shadow-soft"
            >
              <blockquote className="font-display text-lg font-medium italic leading-relaxed text-ink">
                “{v.quote}”
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo(v.id, 120)}
                  alt={v.name}
                  className="h-11 w-11 rounded-full object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-ink">{v.name}</p>
                  <p className="text-xs text-ink/55">{v.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Why we built this — a personal, founder-voiced note */}
      <section className="border-y border-clay-100 bg-clay-50/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <p className="font-display text-xs uppercase tracking-[0.18em] text-clay-500">
            Why we built this
          </p>
          <p className="mt-6 font-display text-2xl leading-relaxed text-ink sm:text-[1.7rem]">
            I kept watching people I admire — the baker two doors down, the
            florist who knows every regular by name — pour everything into their
            craft, then feel a little guilty every time their Instagram went
            quiet for a month. Marketing shouldn’t be a second full-time job you
            never signed up for. So we built the quiet partner we wished
            existed: one you can just text, and then get back to the work you
            actually love.
          </p>
          <p className="mt-8 text-sm text-ink/55">— Nasser, founder</p>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-24">
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
