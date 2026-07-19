import { Reveal, RisingWords } from './_components/motion';
import { HeroPhone } from './_components/hero-sms';
import { Faq } from './_components/faq';

// Real photography served straight from Unsplash's CDN (free license) so we
// don't ship large binaries in the repo.
const photo = (id: string, w = 800) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

const MARQUEE = [
  'cafés',
  'salons',
  'barbershops',
  'florists',
  'bakeries',
  'studios',
  'taquerias',
  'boutiques',
  'gyms',
  'bookshops',
];

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
];

const SAMPLES = [
  {
    file: 'promo.jpg',
    prompt: 'make a promo for 50% off all lattes this Friday',
    tilt: '-rotate-1',
  },
  {
    file: 'quote.jpg',
    prompt: 'a quote card: the best ideas are brewed, not forced',
    tilt: 'rotate-1',
  },
  {
    file: 'title.jpg',
    prompt: 'a graphic for our spring bouquet launch',
    tilt: '-rotate-1',
  },
  {
    file: 'cta.jpg',
    prompt: 'a come-visit-us post with our hours',
    tilt: 'rotate-1',
  },
];

const VOICES = [
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
];

const FAQS = [
  {
    q: 'Do I need to install or learn anything?',
    a: 'No. There’s no app and no dashboard — everything happens right in your text messages. If you can text a friend, you can use this.',
  },
  {
    q: 'What if I don’t like a post?',
    a: 'Just say so. Text back “make it warmer” or “swap the photo” and we’ll redo it. Nothing goes out until you’re happy with it.',
  },
  {
    q: 'Do you need my passwords?',
    a: 'Never. You connect your accounts through a secure service, and we only ever get permission to post — not to see your login.',
  },
];

export default function Home() {
  return (
    <main className="overflow-x-clip">
      {/* ─────────────────────────── Hero ─────────────────────────── */}
      <section className="bg-warm-radial">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-14 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow mb-6 animate-fade-in">
              ✳ Run entirely over text
            </p>

            <h1 className="max-w-2xl font-display text-[clamp(3rem,9vw,5.5rem)] font-semibold leading-[0.98] tracking-tight">
              <RisingWords text="Your social media," />
              <br />
              <span className="wonk italic text-clay-600">
                <RisingWords text="handled." startDelay={280} />
              </span>
            </h1>

            <p
              className="mt-8 max-w-lg animate-fade-in text-lg leading-relaxed text-ink/70"
              style={{ animationDelay: '600ms' }}
            >
              We plan, write, design, and publish your posts almost entirely on
              our own. You just reply to a text now and then. The done-for-you
              calm of a $1,500/mo agency — without the agency.
            </p>

            <div
              className="mt-10 flex flex-wrap items-center gap-4 animate-fade-in"
              style={{ animationDelay: '750ms' }}
            >
              <a href="/billing" className="btn-clay">
                See plans
                <span aria-hidden className="btn-arrow">
                  →
                </span>
              </a>
              <a
                href="/demo"
                className="link-draw font-medium text-ink/80 hover:text-ink"
              >
                Watch it work ↗
              </a>
            </div>

            <p
              className="mt-6 animate-fade-in font-mono text-[11px] uppercase tracking-[0.18em] text-ink/55"
              style={{ animationDelay: '900ms' }}
            >
              No dashboard · No passwords · Cancel anytime
            </p>
          </div>

          <div className="animate-fade-in" style={{ animationDelay: '400ms' }}>
            <HeroPhone />
          </div>
        </div>
      </section>

      {/* ───────────────────── Marquee divider ───────────────────── */}
      <div
        className="pause-on-hover overflow-hidden border-y border-ink/10 bg-parchment/70 py-3.5"
        aria-hidden
      >
        <div className="flex w-max animate-marquee whitespace-nowrap font-mono text-xs uppercase tracking-[0.24em] text-ink/50">
          {[0, 1].map((copy) => (
            <span key={copy} className="flex">
              {MARQUEE.map((word) => (
                <span key={word} className="mx-5 flex items-center gap-10">
                  {word}
                  <span className="text-clay-500">✳</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* ───────────────────── How it works ───────────────────── */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-28">
        <Reveal>
          <p className="eyebrow">№ 1 — The routine</p>
          <h2 className="mt-4 max-w-xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Three steps. Then, mostly{' '}
            <span className="wonk italic text-clay-600">silence.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 130}>
              <div className="group relative border-t-2 border-ink/15 pt-6 transition-colors duration-500 hover:border-clay-500">
                <span className="font-mono text-sm text-clay-500">{s.n}</span>
                <h3 className="mt-3 font-display text-2xl font-medium leading-snug">
                  {s.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink/65">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────────────── Samples gallery ───────────────────── */}
      <section className="border-y border-ink/10 bg-parchment/70">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">№ 2 — The work</p>
              <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                Real posts, spelled{' '}
                <span className="wonk italic text-clay-600">right.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink/60">
              Your photos, real typography, your colors — not blurry AI art with
              garbled text. Every sample here came out of the same engine that
              would make yours.
            </p>
          </Reveal>

          <div className="mt-16 grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
            {SAMPLES.map((s, i) => (
              <Reveal key={s.file} delay={i * 110}>
                <figure className="group">
                  {/* The request, styled as the text it actually was */}
                  <figcaption className="mb-4 flex justify-end">
                    <span className="max-w-[240px] rounded-2xl rounded-br-md bg-clay-500 px-4 py-2.5 text-[13px] leading-snug text-white shadow-soft">
                      {s.prompt}
                    </span>
                  </figcaption>
                  <div
                    className={`overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-soft transition-all duration-500 ease-out ${s.tilt} group-hover:rotate-0 group-hover:shadow-lift`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/samples/${s.file}`}
                      alt={`Finished post for: ${s.prompt}`}
                      loading="lazy"
                      className="aspect-square w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                    />
                  </div>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Voices ───────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <Reveal>
          <p className="eyebrow">№ 3 — The owners</p>
        </Reveal>

        {/* One giant editorial pull-quote */}
        <Reveal delay={80}>
          <figure className="relative mt-10">
            <span
              aria-hidden
              className="pointer-events-none absolute -left-3 -top-14 select-none font-display text-[10rem] leading-none text-clay-500/20 sm:-left-8"
            >
              “
            </span>
            <blockquote className="max-w-3xl font-display text-3xl font-medium italic leading-[1.2] tracking-tight text-ink sm:text-[2.6rem]">
              I run a coffee shop, not a marketing department. I text them
              what’s going on and my Instagram just…{' '}
              <span className="text-clay-600">stays alive.</span>
            </blockquote>
            <figcaption className="mt-8 flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo('1494790108377-be9c29b29330', 120)}
                alt="Rosa Delgado"
                className="h-12 w-12 rounded-full object-cover"
              />
              <div className="font-mono text-xs uppercase tracking-[0.16em] text-ink/55">
                Rosa Delgado — Neighborhood café
              </div>
            </figcaption>
          </figure>
        </Reveal>

        {/* Two supporting voices */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2">
          {VOICES.map((v, i) => (
            <Reveal key={v.name} delay={i * 130}>
              <figure className="flex h-full flex-col justify-between rounded-3xl border border-ink/10 bg-white p-8 shadow-soft transition-shadow duration-500 hover:shadow-lift">
                <blockquote className="font-display text-xl font-medium italic leading-relaxed text-ink">
                  “{v.quote}”
                </blockquote>
                <figcaption className="mt-8 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo(v.id, 120)}
                    alt={v.name}
                    className="h-11 w-11 rounded-full object-cover"
                  />
                  <div>
                    <p className="text-sm font-semibold text-ink">{v.name}</p>
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/50">
                      {v.role}
                    </p>
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────────────── FAQ ───────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-28">
        <Reveal>
          <p className="eyebrow">№ 4 — Questions</p>
          <h2 className="mb-10 mt-4 font-display text-4xl font-semibold tracking-tight">
            Asked, <span className="wonk italic text-clay-600">answered.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <Faq items={FAQS} />
        </Reveal>
      </section>

      {/* ───────────────────── Final CTA ───────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-4xl bg-ink px-8 py-20 text-center text-paper sm:px-16">
            {/* Warm glow inside the dark panel */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-clay-500/25 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-40 right-[-6rem] h-72 w-72 rounded-full bg-brass/15 blur-3xl"
            />

            {/* A floating text bubble, like the one that starts everything */}
            <div className="mx-auto mb-10 w-fit animate-float-slow rounded-2xl rounded-bl-md bg-paper/10 px-5 py-3 font-mono text-xs text-paper/70 backdrop-blur-sm">
              “post something good this week” — you, from the checkout line
            </div>

            <h2 className="mx-auto max-w-2xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Ready to stop{' '}
              <span className="wonk italic text-clay-300">worrying</span> about
              posting?
            </h2>
            <p className="mx-auto mt-6 max-w-md text-paper/60">
              Pick a plan and we’ll take it from there — the rest happens in
              your messages.
            </p>
            <a href="/billing" className="btn-clay mt-10">
              Get started
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
