'use client';

import { useState } from 'react';

/**
 * TCPA express-written-consent language shown at the point of collection.
 * Keep this text in sync with the Privacy Policy's SMS section; the exact
 * wording (with a timestamp) is what makes launch-day texts lawful.
 */
const CONSENT_TEXT =
  'I agree to receive text messages from Handled about its services at the ' +
  'number provided. Consent is not a condition of purchase. Message frequency ' +
  'varies; message & data rates may apply. Reply STOP to opt out, HELP for help.';

/** Pre-launch capture: the SMS-native ask — leave a number, get the first text. */
/**
 * `cta` / `doneText` let a caller reframe the same compliant form. The homepage
 * uses the pre-launch waitlist voice; the /start opt-in page (submitted to the
 * A2P reviewer) uses live-sign-up voice, so it never reads as "not operating
 * yet — why do you need to text?". The consent mechanism is identical either
 * way; only the surrounding copy changes.
 */
export function LeadForm({
  source = 'website',
  cta = 'Text me when it opens',
  doneText = "You're on the list ✳ The first text you get from us will be your welcome.",
}: {
  source?: string;
  cta?: string;
  doneText?: string;
}) {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [phone, setPhone] = useState('');
  const [consented, setConsented] = useState(false);
  const [optedIn, setOptedIn] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Consent is NEVER required to submit — A2P 10DLC (error 30923) prohibits
    // making SMS consent a condition of signing up. Only the phone must be
    // valid; the box is the visitor's free, separate choice.
    if (!api || phone.replace(/\D/g, '').length < 10) return setState('error');
    try {
      setState('busy');
      const res = await fetch(`${api}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone,
          source,
          // Record consent truthfully — only a checked box is consent, and the
          // language + timestamp go with it as the audit trail.
          smsConsent: consented,
          ...(consented
            ? { smsConsentText: CONSENT_TEXT, smsConsentAt: new Date().toISOString() }
            : {}),
        }),
      });
      if (!res.ok) throw new Error();
      setOptedIn(consented);
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="rounded-2xl bg-paper/10 px-5 py-4 text-center text-sm text-paper/90 backdrop-blur-sm">
        {optedIn
          ? doneText
          : "Thanks — you're on file. Handled runs entirely over text, so tick the consent box above whenever you're ready and your first text will get you started."}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="tel"
          required
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (state === 'error') setState('idle'); }}
          placeholder="Your cell number"
          className="flex-1 rounded-full border border-paper/25 bg-paper/10 px-5 py-3.5 text-sm text-paper placeholder:text-paper/50 backdrop-blur-sm focus:border-clay-300 focus:outline-none"
        />
        <button type="submit" disabled={state === 'busy'} className="btn-clay justify-center disabled:opacity-60">
          {state === 'busy' ? 'Saving…' : cta}
        </button>
      </div>
      <label className="flex items-start gap-2.5 text-left text-[11px] leading-relaxed text-paper/65">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => { setConsented(e.target.checked); if (state === 'error') setState('idle'); }}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-clay-500"
        />
        <span>
          {CONSENT_TEXT}{' '}
          <a href="/privacy" className="underline hover:text-paper">Privacy</a>
          {' · '}
          <a href="/terms" className="underline hover:text-paper">Terms</a>
        </span>
      </label>
      {state === 'error' && (
        <p className="text-xs text-clay-300">
          That number didn&rsquo;t look right — try again?
        </p>
      )}
    </form>
  );
}
