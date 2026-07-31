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

  /**
   * Send one email. `subject` is optional — SMS has no subject, so the shared
   * reply path doesn't supply one; a sensible default keeps replies threaded.
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
        TextBody: body,
        // Transactional stream keeps these out of any broadcast/marketing
        // reputation bucket — onboarding and approvals are 1:1 service mail.
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.log.error(`Postmark send to ${to} failed: ${res.status} ${detail.slice(0, 300)}`);
      throw new Error(`email send failed: ${res.status}`);
    }
  }
}
