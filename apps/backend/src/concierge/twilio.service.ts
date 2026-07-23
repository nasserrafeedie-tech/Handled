import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';

/**
 * Twilio SMS — the product's only channel (§2). Sends outbound owner texts and
 * validates inbound webhook signatures so nobody can spoof an owner.
 */
@Injectable()
export class TwilioService {
  private readonly log = new Logger(TwilioService.name);
  private client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );

  /**
   * Manual relay: Handled composes every text as normal, but a human carries
   * them to the customer instead of the wire.
   *
   * For the window where a Twilio number exists but is not yet verified to send
   * to US numbers. Without this the account SID is present, so `send` tries the
   * real API, the send is rejected, and the throw happens BEFORE the caller
   * records the message — so the text is lost entirely rather than merely
   * undelivered. That silently breaks the simulator, whose whole job is to hand
   * back what Handled wanted to say.
   */
  private get manualRelay(): boolean {
    return process.env.SMS_MANUAL_RELAY === '1';
  }

  async send(to: string, body: string): Promise<void> {
    if (this.manualRelay) {
      this.log.log(`[manual relay → ${to}] ${body}`);
      return;
    }
    if (!process.env.TWILIO_ACCOUNT_SID) {
      this.log.warn(`[dry-run SMS → ${to}] ${body}`);
      return;
    }
    await this.client.messages.create({
      to,
      body,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      from: process.env.TWILIO_FROM_NUMBER,
    });
  }

  /**
   * Validate the X-Twilio-Signature header (§8 — this is the only thing
   * stopping a stranger from impersonating an owner over the webhook).
   *
   * Fails CLOSED in production: if TWILIO_AUTH_TOKEN is missing we reject
   * rather than trust, so a half-finished deploy is a loud outage instead of a
   * silently open door. Locally (no NODE_ENV=production) an unsigned request is
   * still allowed so the dev SMS simulator keeps working.
   *
   * Twilio signs the exact URL it called, so we accept a match against any
   * plausible spelling of it: the configured PUBLIC_BASE_URL, and the URL
   * rebuilt from proxy headers. Behind Render the two can disagree (http vs
   * https) and a mismatch would reject every real message.
   */
  validateInbound(
    signature: string | undefined,
    candidateUrls: string[],
    params: Record<string, string>,
  ): boolean {
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!token) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error(
          'TWILIO_AUTH_TOKEN is not set — refusing inbound webhook. ' +
            'Set it in the environment to accept real messages.',
        );
        return false;
      }
      this.log.warn('No TWILIO_AUTH_TOKEN (dev) — skipping signature check');
      return true;
    }

    if (!signature) return false;
    return candidateUrls.some((url) =>
      twilio.validateRequest(token, signature, url, params),
    );
  }
}
