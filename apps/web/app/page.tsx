import { Reveal, RisingWords } from './_components/motion';
import { HeroPhone } from './_components/hero-sms';
import { Faq } from './_components/faq';
import { LeadForm } from './_components/lead-form';
import { SAMPLES } from './_lib/samples';

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
    body: 'Five questions over text. Takes about four minutes and there is no form to fill in.',
  },
  {
    n: '02',
    title: 'We make the week’s posts',
    body: 'We write them and build the carousels and graphics, then text you what we came up with.',
  },
  {
    n: '03',
    title: 'You reply “yes”',
    body: 'It goes out at the hour your customers are actually looking. Once you stop wanting to check, tell us and we will just post.',
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
    a: 'No. It all happens in your text messages, the same way you text anyone else. There is no app and nothing to sign into.',
  },
  {
    q: 'What if I don’t like a post?',
    a: 'Tell us what is off — “too formal”, “use the other photo”, “cut the last line” — and we will redo it. Nothing posts until you say so.',
  },
  {
    q: 'What are carousels, and do I get them?',
    a: 'A carousel is a swipeable set of slides — your tip or offer broken into a few clean, branded cards instead of a single photo. They are the most saved and most shared format on Instagram, which is why they are our headline feature. On Growth and Pro we build them from your posts automatically: every word spelled right, in your colors, ready before you have to think about it.',
  },
  {
    q: 'Do you need my passwords?',
    a: 'Never. You connect your accounts through a secure service that hands us permission to post and nothing else. Your login stays yours.',
  },
  {
    q: 'What if it turns out not to be for me?',
    a: 'Then you should not pay for it. Tell us in the first two weeks and we will refund it — text us and it is done, there is no form. By then you will have seen half a dozen posts, which is enough to know. After that you can cancel any time and you will not be billed again.',
  },
];


/**
 * Sample captions ship with their hashtags attached. On the site the writing
 * is the point, so the tags are split off and set quieter — otherwise every
 * tile is half tags and the copy underneath has to shrink to fit.
 */
function captionBody(caption: string): string {
  return caption
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim();
}

function hashtagsOf(caption: string): string {
  return caption
    .split('\n')
    .filter((line) => line.trim().startsWith('#'))
    .join(' ')
    .trim();
}

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
              Every week we make your posts and text them to you. You look them
              over between customers and reply yes. An agency charges $1,500 a
              month to do the same job.
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
              Nothing to log into, we never see your passwords, and the first
              two weeks are refundable if you don&rsquo;t like the work
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
        <div className="mx-auto max-w-4xl px-6 py-28">
          <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">№ 2 — The work</p>
              <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                Real posts, spelled{' '}
                <span className="wonk italic text-clay-600">right.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink/60">
              Some of these we designed. The rest are a photo the owner already
              had, where the writing was the whole job. Both came out of the same
              thing that would write yours.
            </p>
          </Reveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SAMPLES.map((s, i) => (
              <Reveal key={s.file} delay={i * 90}>
                <figure className="group flex h-full flex-col overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-soft transition-shadow duration-500 hover:shadow-lift">
                  <div className="relative overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/samples/${s.file}`}
                      alt={s.alt}
                      loading="lazy"
                      className="aspect-square w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                    />
                    <span className="absolute left-3 top-3 rounded-full bg-paper/90 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/70 backdrop-blur-sm">
                      {s.label}
                    </span>
                  </div>

                  {/* The caption that ships with it — the half nobody shows */}
                  <figcaption className="flex flex-1 flex-col gap-2.5 px-4 pb-5 pt-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-clay-600">
                      {s.brand}
                    </span>
                    <p className="line-clamp-[7] whitespace-pre-line text-[15px] leading-[1.6] text-ink/80">
                      {captionBody(s.caption)}
                    </p>
                    {hashtagsOf(s.caption) && (
                      <p className="mt-auto pt-1 text-[12px] leading-relaxed text-ink/40">
                        {hashtagsOf(s.caption)}
                      </p>
                    )}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>

          {/* Carousels — the Growth flagship. Shown big, with real slides in a
              swipe strip, because it's the single biggest reason to move up. */}
          <Reveal delay={80}>
            <div className="mt-20 rounded-4xl border border-ink/10 bg-white p-8 shadow-soft sm:p-12">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="eyebrow">On Growth &amp; Pro — the flagship</p>
                  <h3 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                    Your tips, turned into{' '}
                    <span className="wonk italic text-clay-600">
                      carousels people swipe.
                    </span>
                  </h3>
                </div>
                <p className="max-w-xs text-[15px] leading-relaxed text-ink/60">
                  The things worth saying — how whitening works, what makes your
                  espresso different — broken into clean, branded slides.
                  Carousels are the most-saved, most-shared format on Instagram,
                  and we build them from your posts automatically. Every word
                  spelled right, in your colors.
                </p>
              </div>

              {/* The real thing: swipe the actual rendered slides */}
              <div className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[1, 2, 3, 4].map((n) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={n}
                    src={`/samples/carousel-slide-${n}.png`}
                    alt={`Carousel slide ${n} of 4 — an educational coffee tip as a branded slide`}
                    loading="lazy"
                    className="w-56 shrink-0 snap-start rounded-2xl border border-ink/10 shadow-soft sm:w-64"
                  />
                ))}
              </div>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/45">
                ← swipe · one post, four slides, built for you
              </p>
            </div>
          </Reveal>

          {/* Reels — the Growth-plan differentiator, shown small and playing */}
          <Reveal delay={100}>
            <div className="mx-auto mt-16 flex max-w-3xl flex-col items-center gap-8 rounded-4xl border border-ink/10 bg-white p-8 shadow-soft sm:flex-row sm:gap-10 sm:p-10">
              <div className="relative shrink-0">
                <div
                  aria-hidden
                  className="absolute -inset-5 -z-10 rounded-full bg-clay-200/40 blur-2xl"
                />
                <video
                  src="/samples/reel-demo.mp4"
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-40 rounded-2xl border border-ink/10 shadow-lift"
                  aria-label="Sample reel cut by the engine: a peek inside Rosa's coffee shop"
                />
              </div>
              <div>
                <p className="eyebrow">On Growth &amp; Pro</p>
                <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  Film it. <span className="wonk italic text-clay-600">We’ll cut it.</span>
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink/65">
                  Send a few 10-second clips from your phone and we cut them
                  into a reel in your colors, with something worth watching in
                  the first three seconds. It is your real footage. We never
                  generate video.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <p className="mx-auto mt-14 max-w-2xl text-center text-[15px] leading-relaxed text-ink/60">
              Captions are written for how the platforms actually work now. The
              hook goes in the first 125 characters, because that is all anyone
              reads before the caption cuts off. Plain search words go near the
              top, since these apps are search engines now. And every post is
              written to be sent to someone — one share into a DM does more for
              reaching new people than a dozen likes.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ───────────────────── Voices ───────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <Reveal>
          <p className="eyebrow">№ 3 — The owners</p>
          <p className="mt-3 max-w-md font-mono text-[11px] uppercase tracking-[0.16em] text-ink/45">
            Illustrative voices — real customer reviews will live here after launch
          </p>
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
              Leave your number and we’ll text you. That first message is
              where it starts, and it is the same place everything else
              happens.
            </p>
            <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4">
              <LeadForm source="homepage-cta" />
              <a href="/billing" className="link-draw text-sm text-paper/60 hover:text-paper">
                or see plans ↗
              </a>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
