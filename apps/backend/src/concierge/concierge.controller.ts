import {
  Controller,
  Post,
  Req,
  Headers,
  Body,
  ForbiddenException,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConciergeService } from './concierge.service';
import { TwilioService } from './twilio.service';

/**
 * Inbound Twilio SMS webhook. Validates the signature, normalizes the payload,
 * and hands off to the Concierge. Replies are sent asynchronously via the API
 * (not TwiML) so one inbound message can produce a natural, delayed reply.
 */
@Controller('webhooks/twilio')
export class ConciergeController {
  constructor(
    private readonly concierge: ConciergeService,
    private readonly twilio: TwilioService,
  ) {}

  @Post('sms')
  @HttpCode(204)
  async inbound(
    @Req() req: Request,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Body() body: Record<string, string>,
  ): Promise<void> {
    if (!this.twilio.validateInbound(signature, candidateUrls(req), body)) {
      throw new ForbiddenException('invalid Twilio signature');
    }

    const numMedia = Number(body.NumMedia ?? '0');
    const mediaUrls: string[] = [];
    const mediaContentTypes: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      if (body[`MediaUrl${i}`]) {
        mediaUrls.push(body[`MediaUrl${i}`]);
        mediaContentTypes.push(body[`MediaContentType${i}`] ?? 'image/jpeg');
      }
    }

    await this.concierge.handleInbound({
      from: body.From,
      body: body.Body ?? '',
      mediaUrls,
      mediaContentTypes,
      twilioSid: body.MessageSid,
    });
  }
}

/**
 * Every spelling of "the URL Twilio just called" that we're willing to check a
 * signature against. Render terminates TLS at its proxy, so the request Express
 * sees is plain http — signing against that alone would reject real messages
 * whenever PUBLIC_BASE_URL is unset or slightly off.
 */
function candidateUrls(req: Request): string[] {
  const path = req.originalUrl || '/webhooks/twilio/sms';
  const urls: string[] = [];

  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (configured) urls.push(`${configured}${path}`);

  const host = req.get('x-forwarded-host') ?? req.get('host');
  if (host) {
    const proto = req.get('x-forwarded-proto') ?? req.protocol ?? 'https';
    urls.push(`${proto}://${host}${path}`);
    // Same host over the other scheme, in case a proxy header is missing.
    urls.push(`${proto === 'https' ? 'http' : 'https'}://${host}${path}`);
  }

  return [...new Set(urls)];
}
