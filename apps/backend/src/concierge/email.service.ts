import { Injectable, Logger } from '@nestjs/common';

/**
 * Transactional email — the second owner channel alongside SMS (Twilio).
 *
 * Email exists so the product works for owners who don't want to hand over a
 * phone number, and so Handled can onboard and serve customers WITHOUT a
 * carrier-approved number (email is not A2P-regulated). The Concierge routes to
 * here or to TwilioService based on the customer's channel; everything above the
 * send is channel-agnostic.
 *
 * Sends via Postmark's HTTP API with a plain fetch — no SDK dependency, same as
 * the LLM client. Dry-runs when POSTMARK_SERVER_TOKEN is unset, exactly like
 * TwilioService, so the whole flow is testable before the provider is wired.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);

  /** The From header. A verified sender on the texthandled.com domain. */
  private get from(): string {
    return process.env.EMAIL_FROM ?? 'Handled <hey@texthandled.com>';
  }

  /** Where a one-click unsubscribe / STOP reply is directed. */
  private get unsubscribeMailto(): string {
    return `mailto:${process.env.EMAIL_INBOUND_ADDRESS ?? 'hey@texthandled.com'}?subject=STOP`;
  }

  /**
   * Send one email. `subject` is optional — SMS has no subject, so the shared
   * reply path doesn't supply one; a sensible default keeps replies threaded.
   * Sends a plain-text body (what the concierge composed) AND a lightly branded
   * HTML version so the email reads like a real message, not a raw blob.
   */
  async send(to: string, body: string, subject?: string): Promise<void> {
    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (!token) {
      this.log.warn(`[dry-run EMAIL → ${to}] ${subject ? `(${subject}) ` : ''}${body}`);
      return;
    }
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: this.from,
        To: to,
        Subject: subject ?? 'Handled ✳',
        TextBody: `${body}\n\n—\nReply STOP to unsubscribe.`,
        HtmlBody: renderHtml(body),
        // Transactional stream keeps these out of any broadcast/marketing
        // reputation bucket — onboarding and approvals are 1:1 service mail.
        MessageStream: 'outbound',
        // One-click unsubscribe for Gmail/Apple Mail; replying STOP works too
        // (the inbound webhook routes it to the same opt-out as SMS).
        Headers: [
          { Name: 'List-Unsubscribe', Value: `<${this.unsubscribeMailto}>` },
          { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.log.error(`Postmark send to ${to} failed: ${res.status} ${detail.slice(0, 300)}`);
      throw new Error(`email send failed: ${res.status}`);
    }
  }
}

/** HTML-escape, so a customer's text can never inject markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap the plain body in a minimal branded template: escape it, turn URLs into
 * clickable links (a reel/carousel link becomes tappable) and newlines into
 * breaks, then frame it with a header and an unsubscribe footer. Deliberately
 * simple, inline-styled HTML — email clients strip <style> and external CSS.
 */
export function renderHtml(body: string): string {
  const linked = esc(body)
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#8C2F39;">$1</a>',
    )
    .replace(/\n/g, '<br>');
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;',
    'max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6;">',
    '<div style="font-size:18px;font-weight:600;margin-bottom:16px;">Handled ✳</div>',
    `<div>${linked}</div>`,
    '<div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;',
    'font-size:12px;color:#888;">',
    'You&rsquo;re receiving this because you signed up for Handled. ',
    'Reply <b>STOP</b> to unsubscribe.',
    '</div></div>',
  ].join('');
}
