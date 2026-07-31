import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import { ConciergeService } from './concierge.service';

/**
 * Inbound email webhook (Postmark's inbound stream). The email equivalent of
 * the Twilio SMS webhook: an owner replies to a Handled email, Postmark POSTs
 * it here, and we hand it to the same Concierge that processes texts. "Reply
 * YES to approve" works over email exactly as it does over SMS.
 *
 * Postmark gives us `StrippedTextReply` — the reply with quoted history and the
 * signature already removed — so we don't need our own email-reply parser; we
 * fall back to the full TextBody only if it's absent.
 *
 * Secured by a shared secret in the URL (`?token=`), since anyone could POST
 * here otherwise. Fails CLOSED in production if the secret is unset — same
 * stance as the Twilio signature check.
 */
interface PostmarkInbound {
  From?: string;
  FromFull?: { Email?: string };
  Subject?: string;
  TextBody?: string;
  StrippedTextReply?: string;
  MessageID?: string;
}

@Controller('webhooks/email')
export class EmailInboundController {
  constructor(private readonly concierge: ConciergeService) {}

  @Post('inbound')
  @HttpCode(204)
  async inbound(
    @Query('token') token: string | undefined,
    @Body() body: PostmarkInbound,
  ): Promise<void> {
    const secret = process.env.EMAIL_INBOUND_SECRET;
    if (secret) {
      if (token !== secret) throw new ForbiddenException('bad inbound email token');
    } else if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('EMAIL_INBOUND_SECRET not set');
    }

    const from = body.FromFull?.Email ?? body.From;
    if (!from) return;
    const text = (body.StrippedTextReply ?? body.TextBody ?? '').trim();
    if (!text) return;

    await this.concierge.handleInbound({
      from,
      body: text,
      mediaUrls: [],
      mediaContentTypes: [],
    });
  }
}
