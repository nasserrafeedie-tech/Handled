'use client';

import { useEffect, useState } from 'react';

// Each entry maps a friendly label to the exact platform id the backend expects.
// This list must stay in step with the Platform enum in packages/contracts — an
// owner offered a button for a platform we cannot publish to gets a connection
// that silently never posts. X, LinkedIn and YouTube were dropped from the
// product and lingered here.
const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', glyph: 'IG' },
  { id: 'facebook', name: 'Facebook', glyph: 'f' },
  { id: 'tiktok', name: 'TikTok', glyph: '♪' },
  { id: 'threads', name: 'Threads', glyph: '@' },
] as const;

type PlatformId = (typeof PLATFORMS)[number]['id'];

interface Connected {
  platform: string;
  handle?: string;
  connectedAt: string;
}

/**
 * Account connect surface. OAuth to each platform is brokered by Post for Me —
 * owners connect *their* accounts to *our* app (§2). Tapping a button asks the
 * backend for a hosted authorization link and sends the browser there. When we
 * come back, the callback page records what got connected.
 *
 * The customer id normally arrives in the link we text during onboarding
 * (…/connect?c=<id>); without one we run in a friendly demo mode.
 */
export default function ConnectPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [customer, setCustomer] = useState<string | null>(null);
  const [busy, setBusy] = useState<PlatformId | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [connected, setConnected] = useState<Connected[]>([]);

  // Read the customer id from the link and load any accounts already connected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c') ?? params.get('customer');
    setCustomer(c);
    if (c && api) {
      fetch(`${api}/connect/status?customer=${encodeURIComponent(c)}`)
        .then((r) => (r.ok ? r.json() : { accounts: [] }))
        .then((d: { accounts: Connected[] }) => setConnected(d.accounts ?? []))
        .catch(() => {});
    }
  }, [api]);

  async function connect(platform: PlatformId) {
    setNote(null);
    if (!api) {
      setNote('Connecting is almost ready — text us and we’ll get you set up.');
      return;
    }
    if (!customer) {
      setNote(
        'Open this page from the link we texted you so we know which account to link.',
      );
      return;
    }
    try {
      setBusy(platform);
      const res = await fetch(`${api}/connect/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: customer, platform }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      // Post for Me sends the owner back to a single project-level redirect
      // URL, so nothing about this customer survives the round trip. Remember
      // it here; the callback picks it up on the way back in.
      try {
        sessionStorage.setItem('handled:connect:customer', customer);
      } catch {
        /* private mode — the callback falls back to asking for the link again */
      }
      window.location.href = url;
    } catch {
      setNote('Something went wrong. Please try again in a moment.');
      setBusy(null);
    }
  }

  const isConnected = (id: PlatformId) =>
    connected.some((c) => c.platform === id);

  return (
    <main className="bg-warm-radial">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 pb-28 pt-14 sm:pt-20">
        <div className="flex flex-col gap-4">
          <p className="eyebrow animate-fade-in">✳ Setup — two minutes</p>
          <h1 className="font-display text-[clamp(2.4rem,6vw,3.6rem)] font-semibold leading-[1.02] tracking-tight">
            Connect your{' '}
            <span className="wonk italic text-clay-600">accounts.</span>
          </h1>
          <p className="max-w-lg text-ink/60">
            Link the platforms you’d like us to post to. You can revoke access
            at any time, and we’ll only ever post what you approve.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((p) => {
            const done = isConnected(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => connect(p.id)}
                  disabled={busy !== null || done}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-4 text-left text-sm font-medium shadow-soft transition-all duration-300 ease-out hover:border-clay-400 hover:shadow-lift disabled:cursor-default disabled:opacity-70 disabled:hover:border-ink/10 disabled:hover:shadow-soft"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-parchment font-display text-clay-600 transition-colors duration-300 group-hover:bg-clay-500 group-hover:text-white">
                    {p.glyph}
                  </span>
                  <span>
                    {done ? `${p.name} connected` : `Connect ${p.name}`}
                  </span>
                  <span className="ml-auto text-ink/30 transition-transform duration-300 ease-out group-hover:translate-x-1 group-hover:text-clay-500">
                    {busy === p.id ? '…' : done ? '✓' : '→'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {note && (
          <div className="rounded-2xl border border-clay-300/60 bg-clay-50 px-6 py-4 text-sm leading-relaxed text-clay-700">
            {note}
          </div>
        )}

        <div className="rounded-2xl border border-ink/10 bg-parchment/60 px-6 py-4 font-mono text-[11px] leading-relaxed tracking-wide text-ink/55">
          CONNECTIONS ARE BROKERED SECURELY BY POST FOR ME. WE NEVER SEE YOUR
          PASSWORDS — TOKENS ARE ENCRYPTED AT REST.
        </div>
      </div>
    </main>
  );
}
