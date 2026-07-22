'use client';

import { useEffect, useState } from 'react';

interface Connected {
  platform: string;
  handle?: string;
  connectedAt: string;
}

const LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  threads: 'Threads',
};

type Phase = 'working' | 'done' | 'demo' | 'error';

/**
 * Return landing after the owner authorizes a platform. Post for Me sends the
 * browser back here; we ask the backend to sync what got connected, then show a
 * friendly confirmation. From here everything else happens over text.
 */
export default function ConnectCallbackPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [phase, setPhase] = useState<Phase>('working');
  const [accounts, setAccounts] = useState<Connected[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // The query string is empty on the way back — Post for Me redirects to one
    // fixed project URL and cannot carry per-customer parameters — so fall back
    // to what the connect page remembered before it handed the browser over.
    let customer = params.get('customer') ?? params.get('c');
    if (!customer) {
      try {
        customer = sessionStorage.getItem('handled:connect:customer');
      } catch {
        customer = null;
      }
    }
    const demo = params.get('demo') === '1';

    if (demo || !api) {
      setPhase('demo');
      return;
    }
    if (!customer) {
      setPhase('error');
      return;
    }

    fetch(`${api}/connect/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: customer }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { accounts: Connected[] }) => {
        setAccounts(d.accounts ?? []);
        setPhase('done');
      })
      .catch(() => setPhase('error'));
  }, [api]);

  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-6 px-6 py-28 text-center">
      {phase === 'working' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            ⏳
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Finishing up…
          </h1>
          <p className="text-ink/60">
            Just a moment while we confirm your connection.
          </p>
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-clay-500 text-xl text-white">
            ✓
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            You’re connected.
          </h1>
          {accounts.length > 0 ? (
            <p className="text-ink/60">
              We’re now linked to{' '}
              {accounts
                .map((a) => LABELS[a.platform] ?? a.platform)
                .join(', ')}
              . That’s the last bit of setup — everything from here happens over
              text.
            </p>
          ) : (
            <p className="text-ink/60">
              That’s the last bit of setup — everything from here happens over
              text.
            </p>
          )}
          <a
            href="/connect"
            className="mt-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink transition-all duration-300 ease-out hover:border-clay-500 hover:text-clay-600"
          >
            Connect another account
          </a>
        </>
      )}

      {phase === 'demo' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            👋
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            This is a preview.
          </h1>
          <p className="text-ink/60">
            Account connecting isn’t switched on just yet. Once it is, this is
            where you’ll land after linking an account — then everything happens
            over text.
          </p>
          <a
            href="/connect"
            className="mt-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink transition-all duration-300 ease-out hover:border-clay-500 hover:text-clay-600"
          >
            Back to connect
          </a>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            🤔
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Hmm, we couldn’t confirm that.
          </h1>
          <p className="text-ink/60">
            Please open the connect link we texted you and try again — or just
            text us and we’ll sort it out.
          </p>
          <a
            href="/connect"
            className="mt-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink transition-all duration-300 ease-out hover:border-clay-500 hover:text-clay-600"
          >
            Back to connect
          </a>
        </>
      )}
    </main>
  );
}
