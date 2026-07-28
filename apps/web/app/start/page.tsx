import type { Metadata } from 'next';
import { LeadForm } from '../_components/lead-form';

export const metadata: Metadata = {
  title: 'Start with Handled — text sign-up',
  description:
    'Sign up for Handled, the done-for-you social media service run over text. Provide your number and consent to receive account text messages.',
};

/**
 * The A2P 10DLC opt-in proof page.
 *
 * The campaign was rejected (error 30909 / CTA verification) because the
 * reviewer could not verify the opt-in: the submission used the internal name
 * "AISSM" and did not hand them a single URL that shows the whole consent flow.
 * Carriers grade the exact things laid out here — the business and messaging
 * use case (30919), the messages the user will get, message frequency, rates,
 * STOP/HELP, an UNCHECKED-by-default consent box (30925), the consent language
 * (30924), and links to Privacy (30933) and Terms (30934) — all publicly
 * reachable with no login (30921).
 *
 * This is the exact URL to give in the resubmission: <site>/start. Everything a
 * reviewer needs is above the fold on one page, under the real brand name.
 */
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
          businesses, operated entirely over text message. You send us a few
          details about your business; we write, design, and (with your
          approval) publish your posts. There is nothing to install and no
          dashboard to learn.
        </p>
      </div>

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

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-medium">
          Sign up and opt in to texts
        </h2>
        <p className="text-sm text-ink/70">
          Enter your mobile number, then — if you&rsquo;d like the text updates
          described above — check the box to opt in. Checking the box is{' '}
          <strong>optional and not required</strong> to sign up; it&rsquo;s
          simply how you tell us it&rsquo;s okay to text you. We never share or
          sell your number — see our{' '}
          <a className="underline" href="/privacy">Privacy Policy</a> and{' '}
          <a className="underline" href="/terms">Terms</a>.
        </p>
        {/* Reuses the same consent component as the homepage: phone field, an
            unchecked-by-default consent checkbox, the TCPA consent language, and
            Privacy/Terms links — the whole opt-in the reviewer must verify. */}
        <div className="rounded-2xl bg-ink p-6">
          <LeadForm
            source="start-optin"
            cta="Sign up for Handled"
            doneText="You're signed up ✳ Your first text will confirm your details and get you started."
          />
        </div>
      </section>
    </main>
  );
}
