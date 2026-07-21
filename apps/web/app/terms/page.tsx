import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms & Conditions — Handled',
  description: 'The terms governing use of the Handled social media service.',
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
      <div className="flex flex-col gap-3">
        <p className="eyebrow">✳ The fine print</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Terms &amp; Conditions
        </h1>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/45">Last updated: {UPDATED}</p>
      </div>

      <p className="text-ink/75">
        These Terms &amp; Conditions govern your use of Handled (&ldquo;the
        Service&rdquo;), a social media management service for small businesses
        operated over text message. By signing up, you agree to these terms.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">The service</h2>
        <p className="text-ink/75">
          Handled creates, schedules, and (with your approval) publishes social
          media content on your behalf. You remain responsible for the accuracy
          and legality of information you provide and any content you approve for
          posting.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Your content &amp; our license</h2>
        <p className="text-ink/75">
          Your photos, videos, brand, and social accounts are yours, and content
          we create for you is yours once published or paid for. You grant
          Handled a license to use the business name, logos, photos, videos, and
          other materials you send us solely to create and publish content on
          your behalf. We never hold your social media passwords — accounts are
          connected through a secure authorization link and can be disconnected
          by you at any time. Don&rsquo;t send us materials you don&rsquo;t have
          the right to use; you are responsible for third-party claims arising
          from materials you supply.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Approvals &amp; autopilot</h2>
        <p className="text-ink/75">
          In standard mode, nothing is published until you approve it — replying
          &ldquo;yes&rdquo; to a draft confirms the content is accurate and
          approves publication, so check prices, dates, and offers. If you
          ask us to post without checking each time (&ldquo;autopilot&rdquo;),
          you authorize Handled to publish low-risk content without individual
          approval; anything involving prices, percentages, dates, or
          promotions still always requires your explicit approval. Tell us any
          time that you want to approve posts again, and we will.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">SMS messaging terms</h2>
        <p className="text-ink/75">
          By providing your mobile number, you consent to receive
          account-related text messages from Handled, including content for review,
          approval requests, publishing confirmations, and weekly summaries.
          Message frequency varies with your activity (typically a few messages
          per week). <strong>Message and data rates may apply.</strong> Reply{' '}
          <strong>STOP</strong> at any time to opt out, or <strong>HELP</strong>{' '}
          for assistance. Carriers are not liable for delayed or undelivered
          messages. Marketing messages are sent only with your separate,
          explicit consent, and that consent is never a condition of purchase.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">The platforms aren&rsquo;t ours</h2>
        <p className="text-ink/75">
          Instagram, Facebook, TikTok, and other platforms are third parties. We
          are not responsible for platform outages, publishing failures on their
          side, changes to reach or algorithms, or account restrictions they
          impose, and we do not guarantee followers, engagement, or revenue. We
          promise consistent, on-brand publishing and honest reporting.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Payment &amp; our guarantee</h2>
        <p className="text-ink/75">
          Subscriptions are billed on a recurring basis through our payment
          processor. You can cancel at any time; cancellation stops future
          billing and ends the service at the end of the current period.
        </p>
        <p className="text-ink/75">
          <strong>Two-week guarantee.</strong> If you are not happy with the
          work, tell us within 14 days of your first payment and we will refund
          that payment in full. One refund per business, and it applies to your
          first payment only — after that, cancelling stops future billing but
          does not refund the current period. Ask us by text or at the support
          address below; there is no form to fill in.
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
          from use of the Service, and our total liability is limited to the
          amounts you paid us in the three months before the claim. These terms
          are governed by California law.
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
