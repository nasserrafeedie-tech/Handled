'use client';

import { useEffect, useRef, useState } from 'react';

type Phase = 'pick' | 'uploading' | 'done' | 'error';

/**
 * Clip/photo upload behind the link we text owners. Video doesn't fit over
 * MMS (carriers cap ~5MB), so this is the one-tap browser fallback: open the
 * link, pick a few clips, done. The reel cuts itself in the background and
 * the confirmation text arrives over SMS — no waiting on this page.
 */
export default function UploadPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [customer, setCustomer] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('pick');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCustomer(params.get('c') ?? params.get('customer'));
  }, []);

  async function send() {
    if (!api || !customer || files.length === 0) return;
    try {
      setPhase('uploading');
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await fetch(
        `${api}/uploads?customer=${encodeURIComponent(customer)}`,
        { method: 'POST', body: form },
      );
      if (!res.ok) throw new Error(String(res.status));
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }

  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;

  return (
    <main className="bg-warm-radial">
      <div className="mx-auto flex max-w-lg flex-col gap-8 px-6 pb-28 pt-14 sm:pt-20">
        <div>
          <p className="eyebrow mb-5 animate-fade-in">✳ Send your clips</p>
          <h1 className="font-display text-[clamp(2.2rem,8vw,3.2rem)] font-semibold leading-[1.03] tracking-tight">
            Film it. <span className="wonk italic text-clay-600">We’ll cut it.</span>
          </h1>
          <p className="mt-4 text-ink/60">
            Pick 2–5 short videos (5–10 seconds each) straight from your camera
            roll. Don’t overthink it — real beats perfect.
          </p>
        </div>

        {(phase === 'pick' || phase === 'uploading') && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="video/*,image/*"
              multiple
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-3xl border-2 border-dashed border-clay-300 bg-white/70 px-6 py-12 text-center transition-colors hover:border-clay-500"
            >
              <span className="font-display text-2xl text-clay-600">＋</span>
              <span className="mt-2 block text-sm font-medium text-ink">
                {files.length ? 'Change selection' : 'Tap to choose videos'}
              </span>
            </button>

            {files.length > 0 && (
              <div className="flex flex-col gap-2">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm shadow-soft"
                  >
                    <span className="truncate pr-3">{f.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink/50">
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={send}
                  disabled={phase === 'uploading' || !api || !customer}
                  className="btn-clay mt-3 justify-center disabled:opacity-60"
                >
                  {phase === 'uploading'
                    ? `Uploading ${totalMb.toFixed(0)} MB…`
                    : `Send ${files.length} file${files.length > 1 ? 's' : ''}`}
                </button>
                {!customer && (
                  <p className="text-center text-xs text-clay-700">
                    Open this page from the link we texted you so we know whose
                    clips these are.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {phase === 'done' && (
          <div className="rounded-3xl border border-ink/10 bg-white p-8 text-center shadow-soft">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-clay-500 text-xl text-white">✓</div>
            <h2 className="mt-4 font-display text-2xl font-semibold">Got them.</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              You can close this page — I’ll cut your reel and text you when
              it’s ready to review.
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-3xl border border-clay-300/60 bg-clay-50 p-6 text-center text-sm text-clay-700">
            That upload didn’t go through — check your connection and try
            again, or just text us.
            <button type="button" onClick={() => setPhase('pick')} className="link-draw mt-3 block w-full font-medium">
              Try again
            </button>
          </div>
        )}

        <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40">
          Storefront · You at work · A happy customer
        </p>
      </div>
    </main>
  );
}
