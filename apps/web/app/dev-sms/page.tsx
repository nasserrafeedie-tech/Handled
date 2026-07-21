'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Dev-only texting simulator — the whole product without Twilio or a terminal.
 * A phone-shaped chat that drives the backend's /dev/sms endpoint: type as the
 * customer, the Concierge answers exactly as it would over SMS. The endpoint
 * this talks to is hidden in production, so this page is harmless when
 * deployed: it just reports that the simulator is offline.
 */
type Bubble = { who: 'owner' | 'handled'; text: string };

// Deliberately phrased like a person, not like commands — the product
// interprets meaning now, and the simulator should demo that.
const QUICK = [
  'hi',
  'yes',
  "what's my plan?",
  'just post it, stop asking me',
  'check with me first from now on',
  'how do I get reels?',
  'STOP',
];

export default function DevSmsPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [phone, setPhone] = useState('+14245550199');
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  // A different number is a different customer — old bubbles would read as
  // the bot repeating itself, so the thread resets with the number.
  useEffect(() => {
    setThread([]);
  }, [phone]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setErr('');
    setBusy(true);
    setThread((t) => [...t, { who: 'owner', text }]);
    setDraft('');
    try {
      const res = await fetch(`${api}/dev/sms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: phone, body: text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { replies } = (await res.json()) as { replies: string[] };
      setThread((t) => [
        ...t,
        ...replies.map((r): Bubble => ({ who: 'handled', text: r })),
      ]);
      if (replies.length === 0) {
        setThread((t) => [
          ...t,
          {
            who: 'handled',
            text: '(no reply — if it was after 9pm in the customer’s timezone, the quiet-hours queue is holding it)',
          },
        ]);
      }
    } catch {
      setErr(
        'Simulator offline. Run the backend locally (port 3001) — this page only works in dev.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-14">
      <p className="eyebrow">✳ Dev tools</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Texting simulator
      </h1>
      <p className="mt-2 text-sm text-ink/60">
        Type as a customer would. New number = brand-new signup. Try “hi”, then
        answer the onboarding questions; “yes” approves a draft.
      </p>

      <label className="mt-6 block font-mono text-[11px] uppercase tracking-[0.16em] text-ink/55">
        Texting from
      </label>
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-4 py-2.5 font-mono text-sm focus:border-clay-500 focus:outline-none"
      />

      <div className="mt-6 overflow-hidden rounded-[2rem] border border-ink/10 bg-white shadow-soft">
        <div className="flex items-center justify-center bg-ink py-3 font-mono text-xs text-white">
          Handled ✳
        </div>
        <div className="flex h-[380px] flex-col gap-2 overflow-y-auto bg-paper px-4 py-4">
          {thread.length === 0 && (
            <p className="m-auto text-center text-sm text-ink/40">
              Say “hi” to start
            </p>
          )}
          {thread.map((b, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                b.who === 'owner'
                  ? 'self-end bg-clay-500 text-white'
                  : 'self-start bg-parchment text-ink'
              }`}
            >
              {b.text}
            </div>
          ))}
          {busy && (
            <div className="self-start rounded-2xl bg-parchment px-3.5 py-2 text-sm text-ink/40">
              …
            </div>
          )}
          <div ref={bottom} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="flex gap-2 border-t border-ink/10 bg-white p-3"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Text message"
            className="flex-1 rounded-full border border-ink/15 px-4 py-2 text-sm focus:border-clay-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-clay-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-clay-400 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => void send(q)}
            disabled={busy}
            className="rounded-full border border-ink/15 px-3.5 py-1.5 font-mono text-xs text-ink/70 transition-colors hover:border-clay-500 hover:text-clay-600 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {err && <p className="mt-4 text-sm text-clay-700">{err}</p>}
    </main>
  );
}
