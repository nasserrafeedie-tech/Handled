import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms & Conditions — AISSM',
  description: 'The terms governing use of the AISSM social media service.',
};

const UPDATED = 'July 18, 2026';

/**
 * Terms & Conditions. Referenced by the A2P 10DLC campaign registration and
 * linked alongside the Privacy Policy. Includes the SMS terms carriers expect
 * (consent, frequency, STOP/HELP, rates).
 */
export default function TermsPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16 leading-relaxed">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Terms &amp; Conditions
        </h1>
        <p className="text-sm text-ink/50">Last updated: {UPDATED}</p>
      </div>

      <p className="text-ink/75">
        These Terms &amp; Conditions govern your use of AISSM (&ldquo;the
        Service&rdquo;), a social media management service for small businesses
        operated over text message. By signing up, you agree to these terms.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">The service</h2>
        <p className="text-ink/75">
          AISSM creates, schedules, and (with your approval) publishes social
          media content on your behalf. You remain responsible for the accuracy
          and legality of information you provide and any content you approve for
          posting.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">SMS messaging terms</h2>
        <p className="text-ink/75">
          By providing your mobile number, you consent to receive
          account-related text messages from AISSM, including content for review,
          approval requests, publishing confirmations, and weekly summaries.
          Message frequency varies with your activity (typically a few messages
          per week). <strong>Message and data rates may apply.</strong> Reply{' '}
          <strong>STOP</strong> at any time to opt out, or <strong>HELP</strong>{' '}
          for assistance. Carriers are not liable for delayed or undelivered
          messages.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Payment</h2>
        <p className="text-ink/75">
          Subscriptions are billed on a recurring basis through our payment
          processor. You can cancel at any time; cancellation stops future
          billing and ends the service at the end of the current period.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Acceptable use</h2>
        <p className="text-ink/75">
          You agree not to use the Service to send unlawful, misleading, or
          abusive content, or to violate the policies of any social media
          platform. We may suspend the Service for misuse.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Disclaimer &amp; liability</h2>
        <p className="text-ink/75">
          The Service is provided &ldquo;as is.&rdquo; To the extent permitted by
          law, we are not liable for indirect or consequential damages arising
          from use of the Service.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Contact</h2>
        <p className="text-ink/75">
          Questions? Contact us at{' '}
          <a className="underline" href="mailto:support@aissm.app">
            support@aissm.app
          </a>
          .
        </p>
      </section>
    </main>
  );
}
