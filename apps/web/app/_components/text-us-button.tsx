'use client';

/**
 * The live-product CTA: tap → the owner's Messages app opens with HANDLED
 * pre-filled to our real number — the free-taste funnel's front door. The
 * `sms:` scheme with `?&body=` is the one form both iOS and Android honor.
 *
 * The number comes from NEXT_PUBLIC_SMS_NUMBER (set on Vercel; the same var
 * /start uses). Without it — local dev, or if it's ever unset — the button
 * degrades to linking /start rather than advertising a dead number.
 */
export function TextUsButton({
  source,
  tone = 'dark',
}: {
  source?: string;
  /** 'dark' sits on the ink closer panel; 'light' on the warm hero. */
  tone?: 'dark' | 'light';
}) {
  const number = process.env.NEXT_PUBLIC_SMS_NUMBER; // "+1 (424) 677-1407"
  if (!number) {
    return (
      <a href="/start" className="btn-clay justify-center text-base" data-source={source}>
        Get your free post →
      </a>
    );
  }
  const digits = number.replace(/[^\d+]/g, '');
  return (
    <div className="flex flex-col items-center gap-2">
      <a
        href={`sms:${digits}?&body=HANDLED`}
        className="btn-clay justify-center px-8 py-4 text-base"
        data-source={source}
      >
        Text HANDLED to {number}
      </a>
      <p
        className={`font-mono text-[11px] uppercase tracking-[0.16em] ${
          tone === 'dark' ? 'text-paper/45' : 'text-ink/50'
        }`}
      >
        Free first post · no signup · reply STOP anytime
      </p>
    </div>
  );
}
