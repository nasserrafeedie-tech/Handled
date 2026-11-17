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

type Phase = 'working' | 'done' | 'waiting' | 'retry' | 'taken' | 'failed' | 'demo' | 'error';

type Outcome = 'connected' | 'retry' | 'taken' | 'failed' | 'waiting';

interface FinishResponse {
  outcome?: Outcome;
  accounts?: Connected[];
  reason?: string;
}

/**
 * What Post for Me appends to the redirect: isSuccess, accountIds,
 * failedAccountIds, error. We used to ignore all of it — so a refused
 * connect (most often "this Instagram is already registered under another
 * id") looked exactly like a slow one, and the owner waited forever.
 */
function readReturn(params: URLSearchParams) {
  const list = (key: string) =>
    params
      .getAll(key)
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
  const success = params.get('isSuccess');
  return {
    isSuccess: success === null ? undefined : success === 'true',
    accountIds: list('accountIds'),
    failedAccountIds: list('failedAccountIds'),
    error: params.get('error') ?? undefined,
  };
}

/**
 * Return landing after the owner authorizes a platform. Post for Me sends the
 * browser back here; we ask the backend to sync what got connected, then show a
 * friendly confirmation. From here everything else happens over text.
 */
export default function ConnectCallbackPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [phase, setPhase] = useState<Phase>('working');
  const [accounts, setAccounts] = useState<Connected[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [retryHref, setRetryHref] = useState('/connect');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ret = readReturn(params);
    // The query string carries no customer on the way back — Post for Me
    // redirects to one fixed project URL — so fall back to what the connect
    // page remembered before it handed the browser over.
    let customer = params.get('customer') ?? params.get('c');
    if (!customer) {
      try {
        customer =
          sessionStorage.getItem('handled:connect:customer') ??
          localStorage.getItem('handled:connect:customer');
      } catch {
        customer = null;
      }
    }
    const demo = params.get('demo') === '1';

    if (demo || !api) {
      setPhase('demo');
      return;
    }

    const show = (d: FinishResponse, who: string | null) => {
      if (who) setRetryHref(`/connect?customer=${encodeURIComponent(who)}`);
      setReason(d.reason ?? null);
      if (d.accounts?.length) setAccounts(d.accounts);
      switch (d.outcome) {
        case 'connected':
          setPhase('done');
          return true;
        case 'retry':
        case 'taken':
        case 'failed':
          setPhase(d.outcome);
          return true;
        default:
          return false;
      }
    };

    if (!customer) {
      // The mobile case: the OAuth return opened in a different browser than
      // the one that started it (often the Instagram app's), so nothing local
      // knows who this is. The SERVER does — the connect was recorded when it
      // started, and the new account names its owner. The owner gets their
      // confirmation over text.
      fetch(`${api}/connect/reconcile-pending`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ret),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: FinishResponse & { reconciled: number; customerId?: string }) => {
          if (show(d, d.customerId ?? null)) return;
          setPhase(d.reconciled > 0 ? 'done' : 'waiting');
        })
        .catch(() => setPhase('error'));
      return;
    }

    // Post for Me can register the account a beat after the browser lands
    // back here, so poll for up to ~30s when it's genuinely still coming.
    // A clear answer (connected / refused / one more tap) ends it at once.
    let cancelled = false;
    const sync = () =>
      fetch(`${api}/connect/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: customer, ...ret }),
      }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<FinishResponse>;
      });
    (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const d = await sync();
          if (cancelled) return;
          if (show(d, customer)) return;
        } catch {
          if (cancelled) return;
          setPhase('error');
          return;
        }
        await new Promise((res) => setTimeout(res, 5000));
        if (cancelled) return;
      }
      // Still nothing after ~30s. The server-side sweep keeps retrying and
      // texts the owner when it lands, so tell them that instead of lying.
      setPhase('waiting');
    })();
    return () => {
      cancelled = true;
    };
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
            href={retryHref}
            className="mt-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink transition-all duration-300 ease-out hover:border-clay-500 hover:text-clay-600"
          >
            Connect another account
          </a>
        </>
      )}

      {phase === 'waiting' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            ⏳
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Almost there.
          </h1>
          <p className="text-ink/60">
            Your login went through — the platform is just taking a moment to
            hand things over. No need to do anything: we keep checking, and
            we&rsquo;ll text you the moment it&rsquo;s confirmed.
          </p>
        </>
      )}

      {phase === 'retry' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            🔁
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            One more tap.
          </h1>
          <p className="text-ink/60">
            This account still had an old link to Handled, so we cleared it.
            Connect once more and it&rsquo;ll go straight through.
          </p>
          <a
            href={retryHref}
            className="mt-2 rounded-full bg-clay-500 px-6 py-3 text-sm font-semibold text-white transition-all duration-300 ease-out hover:bg-clay-600"
          >
            Finish connecting
          </a>
        </>
      )}

      {phase === 'taken' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            🔒
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Already linked elsewhere.
          </h1>
          <p className="text-ink/60">
            That account is connected to a different Handled account. Text us
            and we&rsquo;ll move it over for you. It only takes a minute.
          </p>
        </>
      )}

      {phase === 'failed' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            🤔
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            That didn&rsquo;t connect.
          </h1>
          <p className="text-ink/60">
            {reason ?? 'The connection didn’t go through. Try once more, and if it happens again just text us.'}
          </p>
          <a
            href={retryHref}
            className="mt-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink transition-all duration-300 ease-out hover:border-clay-500 hover:text-clay-600"
          >
            Try again
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
