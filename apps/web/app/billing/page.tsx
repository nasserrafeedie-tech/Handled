'use client';

import { useState } from 'react';

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
    price: '$149',
    cadence: '/mo',
    blurb: 'For a single location just getting consistent.',
    features: ['3 posts / week', '1 platform', 'Text approval', 'Monthly recap'],
    highlight: false,
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$349',
    cadence: '/mo',
    blurb: 'The sweet spot — more posts, more places, less work for you.',
    features: [
      '7 posts / week',
      'Up to 3 platforms',
      'Carousels & graphics',
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
      'Priority drafts',
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
        body: JSON.stringify({ plan }),
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
    <main className="bg-warm-radial">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-20">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Simple plans, plain pricing.
          </h1>
          <p className="mx-auto max-w-md text-ink/60">
            Cancel anytime. Everything after checkout happens over text — no
            dashboard to learn.
          </p>
        </div>

        <ul className="grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => (
            <li
              key={plan.id}
              className={`flex flex-col rounded-4xl border p-7 shadow-soft transition ${
                plan.highlight
                  ? 'border-clay-300 bg-white ring-2 ring-clay-400'
                  : 'border-clay-100 bg-white/80'
              }`}
            >
              {plan.highlight && (
                <span className="mb-3 w-fit rounded-full bg-clay-500 px-3 py-0.5 text-xs font-medium text-white">
                  Most popular
                </span>
              )}
              <h2 className="font-display text-2xl font-medium">{plan.name}</h2>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold tracking-tight">
                  {plan.price}
                </span>
                <span className="text-sm text-ink/45">{plan.cadence}</span>
              </div>
              <p className="mt-3 text-sm text-ink/60">{plan.blurb}</p>
              <ul className="mt-6 flex flex-col gap-2.5 text-sm text-ink/75">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="mt-0.5 grid h-4 w-4 place-items-center rounded-full bg-clay-100 text-[10px] text-clay-600"
                    >
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => choose(plan.id)}
                disabled={busy !== null}
                className={`mt-8 w-full rounded-full px-4 py-3 text-sm font-semibold transition disabled:opacity-60 ${
                  plan.highlight
                    ? 'bg-clay-500 text-white hover:bg-clay-600'
                    : 'border border-ink/15 text-ink hover:border-ink/40'
                }`}
              >
                {busy === plan.id ? 'Starting…' : `Choose ${plan.name}`}
              </button>
            </li>
          ))}
        </ul>

        {note && (
          <p className="text-center text-sm text-clay-700">{note}</p>
        )}

        <p className="text-center text-sm text-ink/60">
          Not sure which fits?{' '}
          <span className="text-clay-700">
            Text us — a real person will help you pick.
          </span>
        </p>

        <p className="text-center text-xs text-ink/45">
          Payments are processed securely by Stripe. We never store your card
          details.
        </p>
      </div>
    </main>
  );
}
