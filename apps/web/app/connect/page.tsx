'use client';

import { useEffect, useState } from 'react';

// Each entry maps a friendly label to the exact platform id the backend expects.
const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', glyph: 'IG' },
  { id: 'facebook', name: 'Facebook', glyph: 'f' },
  { id: 'tiktok', name: 'TikTok', glyph: '♪' },
  { id: 'x', name: 'X', glyph: '𝕏' },
  { id: 'linkedin', name: 'LinkedIn', glyph: 'in' },
  { id: 'threads', name: 'Threads', glyph: '@' },
  { id: 'youtube', name: 'YouTube', glyph: '▶' },
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
      window.location.href = url;
    } catch {
      setNote('Something went wrong. Please try again in a moment.');
      setBusy(null);
    }
  }

  const isConnected = (id: PlatformId) =>
    connected.some((c) => c.platform === id);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-20">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Connect your accounts
        </h1>
        <p className="text-ink/60">
          Link the platforms you’d like us to post to. You can revoke access at
          any time, and we’ll only ever post what you approve.
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
                className="flex w-full items-center gap-3 rounded-2xl border border-clay-100 bg-white px-4 py-3.5 text-left text-sm font-medium shadow-soft transition hover:border-clay-300 disabled:cursor-default disabled:opacity-70 disabled:hover:border-clay-100"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-clay-50 font-display text-clay-600">
                  {p.glyph}
                </span>
                <span>
                  {done ? `${p.name} connected` : `Connect ${p.name}`}
                </span>
                <span className="ml-auto text-ink/30">
                  {busy === p.id ? '…' : done ? '✓' : '→'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {note && (
        <div className="rounded-2xl border border-clay-200 bg-clay-50 px-5 py-4 text-sm leading-relaxed text-clay-700">
          {note}
        </div>
      )}

      <div className="rounded-2xl border border-clay-100 bg-clay-50/50 px-5 py-4 text-xs leading-relaxed text-ink/55">
        Connections are handled securely through Post for Me. We never see your
        passwords, and access tokens are encrypted at rest.
      </div>
    </main>
  );
}
