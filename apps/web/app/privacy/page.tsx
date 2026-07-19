import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — AISSM',
  description: 'How AISSM handles your information, including SMS/text messaging.',
};

const UPDATED = 'July 18, 2026';

/**
 * Privacy Policy. Written to satisfy A2P 10DLC campaign requirements:
 * it explicitly states mobile numbers are never shared, notes message
 * frequency, and includes the "message and data rates may apply" disclosure.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16 leading-relaxed">
      <div className="flex flex-col gap-3">
        <p className="eyebrow">✳ The fine print</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/45">Last updated: {UPDATED}</p>
      </div>

      <p className="text-ink/75">
        AISSM (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) provides
        a social media management service for small businesses, operated over
        text message (SMS). This policy explains what information we collect and
        how we use it.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Information we collect</h2>
        <p className="text-ink/75">
          When you sign up, we collect your name, mobile phone number, business
          details, and the content you ask us to create or publish on your
          behalf. We collect this only to run the service you signed up for.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">SMS / text messaging</h2>
        <p className="text-ink/75">
          By providing your mobile number during signup, you consent to receive
          account-related text messages from us — such as content ready for
          review, approval requests, publishing confirmations, and weekly plan
          summaries. Message frequency varies based on your activity and posting
          schedule (typically a few messages per week). Message and data rates
          may apply. You can opt out at any time by replying{' '}
          <strong>STOP</strong>, and reply <strong>HELP</strong> for help.
        </p>
        <p className="text-ink/75 font-medium">
          We do not share, sell, or rent your mobile phone number or SMS
          consent to any third parties or affiliates for their marketing
          purposes. Mobile information is used solely to operate this service.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">How we use your information</h2>
        <p className="text-ink/75">
          We use your information to create and schedule social media content,
          send you the messages described above, process your subscription, and
          improve the service. We use trusted providers (such as our messaging,
          hosting, and payment processors) strictly to deliver the service, and
          they are not permitted to use your information for their own purposes.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Data retention &amp; your choices</h2>
        <p className="text-ink/75">
          We keep your information while your account is active. You may request
          access to or deletion of your data, or stop the service, at any time by
          contacting us. Opting out of texts (reply STOP) stops all non-essential
          messaging.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-medium">Contact</h2>
        <p className="text-ink/75">
          Questions about this policy? Contact us at{' '}
          <a className="underline" href="mailto:support@aissm.app">
            support@aissm.app
          </a>
          .
        </p>
      </section>
    </main>
  );
}
