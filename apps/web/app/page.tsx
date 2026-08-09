import { Reveal, RisingWords } from './_components/motion';
import { HeroPhone } from './_components/hero-sms';
import { Faq } from './_components/faq';
import { LeadForm } from './_components/lead-form';
import { TextUsButton } from './_components/text-us-button';
import { InstaPost } from './_components/insta-post';
import { SAMPLES } from './_lib/samples';

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
    body: 'Seven quick questions over text — a few minutes, no form. Then a ten-minute photo walk fills your photo bank, and real photos beat anything designed.',
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
    q: 'Do you post to my Google Business Profile?',
    a: 'Yes — and it is on every plan, starting with Starter. Your Google Business Profile is what people see when they search your name or find you on Maps, so a steady stream of fresh updates there does more for walk-in customers than almost anything else. We keep it posted alongside your other channels, automatically, from the same texts you already send us.',
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
              Every week we write and design your posts — swipeable carousels,
              graphics, captions — and text them to you. You look them over
              between customers and reply yes. An agency charges $1,500 a month
              to do the same job.
            </p>

            <div
              className="mt-10 flex flex-wrap items-center gap-4 animate-fade-in"
              style={{ animationDelay: '750ms' }}
            >
              <TextUsButton source="hero" tone="light" />
              <a
                href="/billing"
                className="link-draw font-medium text-ink/80 hover:text-ink"
              >
                See plans →
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
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16 sm:py-28">
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
        <div className="mx-auto max-w-4xl px-6 py-16 sm:py-28">
          <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">№ 2 — The work</p>
              <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                Real posts, spelled{' '}
                <span className="wonk italic text-clay-600">right.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink/60">
              Exactly as they&rsquo;d land on your feed. The photos are the
              owner&rsquo;s; the writing is the job — first line built to stop
              the scroll, last line built to be saved or sent to a friend.
            </p>
          </Reveal>

          <div className="mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-16 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:pb-0">
            {SAMPLES.filter((s) =>
              ['photo-cortados.jpg', 'photo-window.jpg', 'composed-bouquet.jpg'].includes(s.file),
            ).map((s, i) => (
              <div key={s.file} className="w-[82vw] max-w-[340px] shrink-0 snap-center sm:w-auto sm:max-w-none">
                <Reveal delay={i * 90} className="h-full">
                  <InstaPost
                    handle={s.brand === "Rosa's Coffee" ? 'rosas.coffee' : 'fieldnote.florals'}
                    accent={s.brand === "Rosa's Coffee" ? '#a4653c' : '#2B5042'}
                    image={`/samples/${s.file}`}
                    alt={s.alt}
                    label={s.label}
                    caption={captionBody(s.caption)}
                    hashtags={hashtagsOf(s.caption)}
                  />
                </Reveal>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/45 sm:hidden">
            ← swipe for more
          </p>

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
                  The things worth saying — how whitening works, what makes
                  your espresso different — broken into clean, branded slides.
                  Before we write an educational post we research the topic on
                  the live web, so the numbers in your slides are real. Then
                  three drafts compete, a judge picks, an editor tightens —
                  every word spelled right, in your colors, on your real
                  photos when you&rsquo;ve sent them.
                </p>
              </div>

              {/* The real thing: swipe the actual rendered slides */}
              <div className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={n}
                    src={`/samples/carousel-slide-${n}.png`}
                    alt={`Carousel slide ${n} of 6 — an educational coffee tip as a branded portrait slide`}
                    loading="lazy"
                    className="w-56 shrink-0 snap-start rounded-2xl border border-ink/10 shadow-soft sm:w-64"
                  />
                ))}
              </div>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/45">
                ← swipe · one post, six slides, researched and built for you
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

      {/* ─────────────── Honesty, where testimonials would go ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <Reveal>
          <div className="rounded-4xl border border-ink/10 bg-parchment/60 px-7 py-12 sm:px-14 sm:py-14">
            <p className="eyebrow">№ 3 — The honesty rules</p>
            <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              No fake reviews here —{' '}
              <span className="wonk italic text-clay-600">ours or yours.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink/65">
              This is where testimonials go, and we just launched — so for now
              it&rsquo;s empty, on purpose. The same rule runs the writing
              engine: it will never invent a customer quote, a statistic, or an
              event for your posts either. Real reviews land here as they
              arrive.
            </p>
            <ul className="mt-9 grid gap-4 sm:grid-cols-3">
              {[
                {
                  t: 'Never a made-up word',
                  b: 'No invented reviews, quotes, or "we sold out by noon" — for us or for you.',
                },
                {
                  t: 'Your real photos win',
                  b: 'A photo you took beats anything we could generate, every single time it exists.',
                },
                {
                  t: 'Numbers are checked',
                  b: 'Educational posts are researched on the live web before we write a claim.',
                },
              ].map((r) => (
                <li
                  key={r.t}
                  className="rounded-2xl border border-ink/10 bg-white px-5 py-5 shadow-soft"
                >
                  <p className="text-sm font-semibold text-ink">✳ {r.t}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{r.b}</p>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* ───────────────────── FAQ ───────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-16 sm:pb-28">
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
      <section className="mx-auto max-w-6xl px-6 pb-16 sm:pb-28">
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
              Your first post is{' '}
              <span className="wonk italic text-clay-300">free.</span>{' '}
              Right now.
            </h2>
            <p className="mx-auto mt-6 max-w-md text-paper/60">
              Text us one line about your business — what you do and one thing
              you&rsquo;d want customers to know this week — and we&rsquo;ll
              write your first post on the spot. Before you&rsquo;ve paid
              anything, before you&rsquo;ve signed up for anything.
            </p>
            <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-5">
              <TextUsButton source="homepage-cta" />
              <p className="text-xs text-paper/40">
                Prefer we reach out instead? Leave your number below.
              </p>
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
