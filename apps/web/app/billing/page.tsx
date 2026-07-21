'use client';

import { useEffect, useState } from 'react';
import { Reveal, RisingWords } from '../_components/motion';

type PlanId = 'starter' | 'growth' | 'pro';

const PLANS: {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  highlight: boolean;
}[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$95',
    cadence: '/mo',
    blurb: 'For a single location just getting consistent.',
    features: [
      '3 posts / week',
      '1 platform',
      'Photos & branded graphics',
      'Text approval',
    ],
    highlight: false,
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$349',
    cadence: '/mo',
    blurb: 'The sweet spot — more posts, more places, and video.',
    features: [
      '7 posts / week',
      'Up to 3 platforms',
      'Reels cut from your clips',
      'Weekly performance tuning',
    ],
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$699',
    cadence: '/mo',
    blurb: 'Full autopilot across every channel you care about.',
    features: [
      'Daily posting',
      'All platforms',
      'Reels & priority drafts',
      'Auto-publish (once trusted)',
    ],
    highlight: false,
  },
];

/**
 * Billing surface. Each "Choose" button starts a Stripe Checkout session via
 * the backend (which flips on the moment STRIPE_SECRET_KEY + price IDs are set).
 * Set NEXT_PUBLIC_API_URL to the deployed backend to make the buttons live;
 * until then they show a friendly "coming soon" note.
 */
export default function BillingPage() {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [ref, setRef] = useState<string | null>(null);

  // Referral links look like /billing?ref=ABC123 — carry the code through
  // checkout so the webhook can credit both sides.
  useEffect(() => {
    setRef(new URLSearchParams(window.location.search).get('ref'));
  }, []);

  async function choose(plan: PlanId) {
    setNote(null);
    if (!api) {
      setNote('Checkout is almost ready — text us to get started today.');
      return;
    }
    try {
      setBusy(plan);
      const res = await fetch(`${api}/billing/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, ...(ref ? { ref } : {}) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch {
      setNote('Something went wrong starting checkout. Please try again.');
      setBusy(null);
    }
  }

  return (
    <main className="overflow-x-clip bg-warm-radial">
      <div className="mx-auto flex max-w-6xl flex-col px-6 pb-28 pt-14 sm:pt-20">
        <div className="text-center">
          <p className="eyebrow mb-6 animate-fade-in">✳ Plans</p>
          <h1 className="font-display text-[clamp(2.6rem,7vw,4.5rem)] font-semibold leading-[1.02] tracking-tight">
            <RisingWords text="Simple plans," />{' '}
            <span className="wonk italic text-clay-600">
              <RisingWords text="plain pricing." startDelay={180} />
            </span>
          </h1>
          <p
            className="mx-auto mt-6 max-w-md animate-fade-in text-ink/60"
            style={{ animationDelay: '600ms' }}
          >
            Cancel anytime. Everything after checkout happens over text — no
            dashboard to learn.
          </p>
        </div>

        <ul className="mt-16 grid items-stretch gap-6 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 120} className="h-full">
              <li
                className={`flex h-full flex-col rounded-4xl p-8 transition-shadow duration-500 ${
                  plan.highlight
                    ? 'relative bg-ink text-paper shadow-lift md:-my-4 md:py-12'
                    : 'border border-ink/10 bg-white shadow-soft hover:shadow-lift'
                }`}
              >
                {plan.highlight && (
                  <>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -top-20 left-1/2 h-44 w-72 -translate-x-1/2 rounded-full bg-clay-500/25 blur-3xl"
                    />
                    <span className="mb-4 w-fit rounded-full bg-clay-500 px-3.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                      Most popular
                    </span>
                  </>
                )}
                <h2 className="font-display text-2xl font-medium">
                  {plan.name}
                </h2>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-5xl font-semibold tracking-tight">
                    {plan.price}
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      plan.highlight ? 'text-paper/50' : 'text-ink/45'
                    }`}
                  >
                    {plan.cadence}
                  </span>
                </div>
                <p
                  className={`mt-4 text-sm leading-relaxed ${
                    plan.highlight ? 'text-paper/65' : 'text-ink/60'
                  }`}
                >
                  {plan.blurb}
                </p>
                <ul
                  className={`mt-7 flex flex-col gap-3 text-sm ${
                    plan.highlight ? 'text-paper/85' : 'text-ink/75'
                  }`}
                >
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <span aria-hidden className="mt-px text-clay-500">
                        ✳
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-9">
                  <button
                    type="button"
                    onClick={() => choose(plan.id)}
                    disabled={busy !== null}
                    className={`w-full rounded-full px-4 py-3.5 text-sm font-semibold transition-all duration-300 ease-out active:scale-[0.98] disabled:opacity-60 ${
                      plan.highlight
                        ? 'bg-clay-500 text-white hover:bg-clay-400 hover:shadow-glow'
                        : 'border border-ink/15 text-ink hover:border-clay-500 hover:text-clay-600'
                    }`}
                  >
                    {busy === plan.id ? 'Starting…' : `Choose ${plan.name}`}
                  </button>
                </div>
              </li>
            </Reveal>
          ))}
        </ul>

        {note && (
          <p className="mt-8 text-center text-sm text-clay-700">{note}</p>
        )}

        {/* The guarantee. Placed under the buttons rather than in the footer
            because it exists to answer the last thought someone has before
            paying — "what if it's no good?" — and it can only do that where
            the decision is actually made. */}
        <Reveal delay={360}>
          <div className="mx-auto mt-12 max-w-xl rounded-4xl border border-ink/10 bg-white/70 px-8 py-7 text-center shadow-soft">
            <p className="eyebrow mb-3">✳ Our guarantee</p>
            <p className="font-display text-xl leading-snug">
              Give it a month. If you don&rsquo;t like the work,{' '}
              <span className="wonk italic text-clay-600">
                we&rsquo;ll refund it.
              </span>
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/65">
              Your whole first month back, no questions and no forms — just text
              us. After that, cancel any time and you won&rsquo;t be billed
              again.
            </p>
          </div>
        </Reveal>

        <p className="mt-10 text-center text-sm text-ink/60">
          Not sure which fits?{' '}
          <span className="font-medium text-clay-700">
            Text us — a real person will help you pick.
          </span>
        </p>

        <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-ink/55">
          Payments handled securely by Stripe — we never see your card
        </p>

        <p className="mx-auto mt-6 max-w-md text-center text-xs leading-relaxed text-ink/50">
          By subscribing you agree to receive texts from Handled to deliver the
          service. Msg &amp; data rates may apply. Reply STOP to cancel, HELP
          for help.
        </p>
      </div>
    </main>
  );
}
