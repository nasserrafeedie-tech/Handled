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
    const url = `${process.env.PUBLIC_BASE_URL ?? ''}/webhooks/twilio/sms`;
    if (!this.twilio.validateSignature(signature, url, body)) {
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
