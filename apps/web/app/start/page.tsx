import type { Metadata } from 'next';
import { EmailSignup } from '../_components/email-signup';

/**
 * The A2P / toll-free opt-in proof page — rebuilt around USER-INITIATED consent.
 *
 * A carrier reviewer rejected the previous web-form version (30923 + an explicit
 * OPT-IN note): "mandatory consent box … phone number is also mandatory …
 * modify your form mechanics so SMS opt-in is entirely optional … consumers must
 * be able to decline messaging and still use your business services." For an
 * SMS-native product there is no way to make a business-initiated web form
 * "optional" — the form itself is the forced-consent problem.
 *
 * So the opt-in is now text-to-join: the customer TEXTS us to start, and their
 * inbound message IS the consent — voluntary by definition, nothing captured on
 * a form, nothing forced. A separate, no-phone email path lets anyone engage
 * without messaging at all, which is exactly what the reviewer asked for.
 *
 * Required disclosures still live here (program name, message types, frequency,
 * rates, STOP/HELP, Privacy/Terms) — carriers grade those regardless of the
 * opt-in mechanism. Set NEXT_PUBLIC_SMS_NUMBER to the provisioned number.
 */

const SMS_KEYWORD = 'HANDLED';
const SMS_NUMBER = process.env.NEXT_PUBLIC_SMS_NUMBER; // e.g. "+1 (866) 747-7513"
const SUPPORT_EMAIL = 'nasser@texthandled.com';

export const metadata: Metadata = {
  title: 'Start with Handled — text to begin',
  description:
    'Handled is a done-for-you social media service run over text. Text ' +
    'HANDLED to get started, entirely optional — or email us instead, no phone required.',
};

export default function StartPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16 leading-relaxed">
      <div className="flex flex-col gap-3">
        <p className="eyebrow">✳ Start with Handled</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Your social media, handled — over text.
        </h1>
        <p className="text-ink/75">
          Handled is a done-for-you social media service for local small
          businesses, operated entirely over text message. We write, design,
          and (with your approval) publish your posts. There is nothing to
          install and no dashboard to learn.
        </p>
      </div>

      {/* PRIMARY opt-in: user-initiated. Texting us IS the consent — voluntary,
          no form, nothing forced. */}
      <section className="flex flex-col gap-3 rounded-2xl bg-ink p-6 text-paper">
        <h2 className="font-display text-lg font-medium">Get started</h2>
        <p className="text-sm text-paper/80">
          Text the word <strong>{SMS_KEYWORD}</strong> to{' '}
          <strong>{SMS_NUMBER ?? '(our number)'}</strong> from your phone. That
          first text is how you opt in — sending it is entirely your choice, and
          you can reply <strong>STOP</strong> at any time to opt out.
        </p>
        {SMS_NUMBER && (
          <a
            href={`sms:${SMS_NUMBER.replace(/[^\d+]/g, '')}?&body=${SMS_KEYWORD}`}
            className="btn-clay mt-1 justify-center"
          >
            Text {SMS_KEYWORD} to {SMS_NUMBER}
          </a>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-parchment/50 p-6">
        <h2 className="font-display text-lg font-medium">
          What texts you&rsquo;ll get
        </h2>
        <ul className="flex flex-col gap-1.5 text-sm text-ink/75">
          <li>• Content ready for you to review</li>
          <li>• Approval requests before anything is posted</li>
          <li>• Confirmations once a post publishes</li>
          <li>• Your weekly plan summary</li>
        </ul>
        <p className="text-sm text-ink/60">
          Message frequency varies with your activity — typically a few messages
          per week. Message &amp; data rates may apply. Reply{' '}
          <strong>STOP</strong> to opt out at any time, or <strong>HELP</strong>{' '}
          for help. Consent is not a condition of purchase.
        </p>
        <p className="text-sm text-ink/60">
          Example message: &ldquo;Hi! Your Tuesday post is ready — a carousel
          about your fall menu. Reply YES to approve or tell me what to
          change.&rdquo;
        </p>
      </section>

      {/* The explicit "decline messaging and still use the business" path the
          reviewer required — no phone number, no SMS. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-ink/10 p-6">
        <h2 className="font-display text-lg font-medium">
          Prefer not to text?
        </h2>
        <p className="text-sm text-ink/70">
          Texting is entirely optional — you never have to give a phone number
          or opt in to messaging to use Handled. Sign up with your email instead
          and we&rsquo;ll run the whole thing over email.
        </p>
        <EmailSignup />
        <p className="text-xs text-ink/50">
          Or just email us at{' '}
          <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <p className="text-xs text-ink/50">
        We never share or sell your number. See our{' '}
        <a className="underline" href="/privacy">Privacy Policy</a> and{' '}
        <a className="underline" href="/terms">Terms</a>.
      </p>
    </main>
  );
}
