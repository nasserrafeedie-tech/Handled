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

  async send(to: string, body: string): Promise<void> {
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

  /** Validate the X-Twilio-Signature header against the request. */
  validateSignature(
    signature: string | undefined,
    url: string,
    params: Record<string, string>,
  ): boolean {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) return true; // dev: no token configured, skip
    if (!signature) return false;
    return twilio.validateRequest(token, signature, url, params);
  }
}
