'use client';

import { useEffect, useState } from 'react';

/**
 * Where the texted "update your card" link lands. Trades the signed token for
 * a Stripe customer-portal session and forwards there; the portal is where the
 * card gets changed. Anything wrong (old link, Stripe portal not switched on)
 * ends on a plain "text us" rather than a dead page.
 */
export default function BillingManagePage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t');
    if (!api || !t) {
      setFailed(true);
      return;
    }
    fetch(`${api}/billing/portal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { url: string | null }) => {
        if (d.url) window.location.replace(d.url);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [api]);

  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-6 px-6 py-28 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
        {failed ? '🤔' : '💳'}
      </div>
      <h1 className="font-display text-4xl font-semibold tracking-tight">
        {failed ? 'That link has expired.' : 'Opening your billing…'}
      </h1>
      <p className="text-ink/60">
        {failed
          ? 'Text us “billing” and we’ll send a fresh one. Your posts are safe in the meantime.'
          : 'One moment while we take you to your secure billing page.'}
      </p>
    </main>
  );
}
