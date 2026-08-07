'use client';

import { useEffect, useRef, useState } from 'react';

interface Shot {
  key: string;
  title: string;
  hint: string;
}

type ShotState = 'todo' | 'uploading' | 'done' | 'error';

/**
 * The photo walk: a guided checklist the owner works through once, phone in
 * hand, while they're at their business. Each row is one shot; picking a
 * photo uploads it immediately (tagged with the shot's key so the drafter
 * can later choose "the owner's face" or "a before" on purpose). No batching,
 * no order, skipping is fine — every shot banked is a post upgraded.
 */
export default function PhotoWalkPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [customer, setCustomer] = useState<string | null>(null);
  const [business, setBusiness] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [states, setStates] = useState<Record<string, ShotState>>({});
  const [finished, setFinished] = useState(false);
  const activeShot = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c') ?? params.get('customer');
    setCustomer(c);
    if (!api || !c) return;
    fetch(`${api}/uploads/shot-list?customer=${encodeURIComponent(c)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { business: string | null; shots: Shot[] }) => {
        setBusiness(d.business);
        setShots(d.shots);
      })
      .catch(() => setShots([]));
  }, [api]);

  const doneCount = shots.filter((s) => states[s.key] === 'done').length;

  function pickFor(key: string) {
    activeShot.current = key;
    inputRef.current?.click();
  }

  async function onPicked(file: File | undefined) {
    const key = activeShot.current;
    if (!file || !key || !api || !customer) return;
    setStates((s) => ({ ...s, [key]: 'uploading' }));
    try {
      const form = new FormData();
      form.append('files', file);
      const res = await fetch(
        `${api}/uploads?customer=${encodeURIComponent(customer)}&subject=${encodeURIComponent(key)}`,
        { method: 'POST', body: form },
      );
      if (!res.ok) throw new Error(String(res.status));
      setStates((s) => ({ ...s, [key]: 'done' }));
    } catch {
      setStates((s) => ({ ...s, [key]: 'error' }));
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function finish() {
    setFinished(true);
    if (api && customer && doneCount > 0) {
      // One thank-you text; failures are invisible — the photos are banked.
      fetch(`${api}/uploads/walk-done?customer=${encodeURIComponent(customer)}`, {
        method: 'POST',
      }).catch(() => undefined);
    }
  }

  return (
    <main className="bg-warm-radial">
      <div className="mx-auto flex max-w-lg flex-col gap-8 px-6 pb-28 pt-14 sm:pt-20">
        <div>
          <p className="eyebrow mb-5 animate-fade-in">✳ The photo walk</p>
          <h1 className="font-display text-[clamp(2.2rem,8vw,3.2rem)] font-semibold leading-[1.03] tracking-tight">
            Ten minutes. <span className="wonk italic text-clay-600">A month of real posts.</span>
          </h1>
          <p className="mt-4 text-ink/60">
            {business ? `Walk ${business}` : 'Walk your business'} with your
            phone and grab each shot below — any order, and skipping one is
            fine. Real photos of you and your work get roughly double the
            response of anything designed.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPicked(e.target.files?.[0])}
        />

        {!finished && shots.length > 0 && (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/50">
              {doneCount} of {shots.length} banked
            </p>
            <div className="flex flex-col gap-3">
              {shots.map((shot) => {
                const st = states[shot.key] ?? 'todo';
                return (
                  <button
                    key={shot.key}
                    type="button"
                    onClick={() => st !== 'uploading' && pickFor(shot.key)}
                    className={`rounded-2xl border px-4 py-4 text-left shadow-soft transition-colors ${
                      st === 'done'
                        ? 'border-clay-500/40 bg-clay-50'
                        : 'border-ink/10 bg-white hover:border-clay-400'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-medium text-ink">{shot.title}</span>
                      <span className="shrink-0 text-sm">
                        {st === 'done' && <span className="text-clay-600">✓ got it</span>}
                        {st === 'uploading' && <span className="text-ink/40">sending…</span>}
                        {st === 'error' && <span className="text-clay-700">tap to retry</span>}
                        {st === 'todo' && <span className="text-ink/30">＋</span>}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink/55">
                      {shot.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={doneCount === 0}
              className="btn-clay justify-center disabled:opacity-60"
            >
              {doneCount === shots.length ? 'Done — that’s the walk ✓' : `Finish with ${doneCount} shot${doneCount === 1 ? '' : 's'}`}
            </button>
          </>
        )}

        {!finished && shots.length === 0 && (
          <p className="text-sm text-ink/50">
            {customer
              ? 'Loading your shot list…'
              : 'Open this page from the link we texted you so we know whose photos these are.'}
          </p>
        )}

        {finished && (
          <div className="rounded-3xl border border-ink/10 bg-white p-8 text-center shadow-soft">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-clay-500 text-xl text-white">✓</div>
            <h2 className="mt-4 font-display text-2xl font-semibold">
              {doneCount > 0 ? `${doneCount} banked.` : 'No rush.'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              {doneCount > 0
                ? 'You can close this page — these start showing up in your drafts. Come back any time you want to top up the bank.'
                : 'This link keeps working — do the walk next time you’re in.'}
            </p>
          </div>
        )}

        <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40">
          Your face · Your hands · Today’s best work
        </p>
      </div>
    </main>
  );
}
