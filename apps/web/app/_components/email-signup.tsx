'use client';

import { useState } from 'react';

/**
 * Email sign-up — the no-phone, no-SMS path into Handled.
 *
 * Email opt-in isn't carrier-regulated, so this ordinary form is compliant and
 * it's the "decline messaging and still use the service" path the SMS reviewer
 * required. On submit we create an email-channel customer and the onboarding
 * interview begins over email.
 */
export function EmailSignup() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !/^\S+@\S+\.\S+$/.test(email)) return setState('error');
    try {
      setState('busy');
      const res = await fetch(`${api}/signup/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error();
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="rounded-xl bg-parchment/60 px-4 py-3 text-sm text-ink/80">
        You&rsquo;re in ✳ Check your inbox — our first email will get you set up.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        inputMode="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
        placeholder="you@yourbusiness.com"
        className="flex-1 rounded-full border border-ink/15 bg-white px-5 py-3 text-sm focus:border-clay-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={state === 'busy' || !api}
        className="btn-clay justify-center disabled:opacity-60"
      >
        {state === 'busy' ? 'Setting up…' : 'Start over email'}
      </button>
      {state === 'error' && (
        <p className="text-xs text-clay-700 sm:w-full">
          That email didn&rsquo;t look right — try again?
        </p>
      )}
    </form>
  );
}
