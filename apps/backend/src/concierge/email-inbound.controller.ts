import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../common/storage.service';
import { ConciergeService } from './concierge.service';

/**
 * Inbound email webhook (Postmark's inbound stream). The email equivalent of
 * the Twilio SMS webhook: an owner replies to a Handled email, Postmark POSTs
 * it here, and we hand it to the same Concierge that processes texts. "Reply
 * YES to approve" works over email exactly as it does over SMS.
 *
 * Postmark gives us `StrippedTextReply` — the reply with quoted history and the
 * signature already removed — so we don't need our own email-reply parser; we
 * fall back to the full TextBody when it's empty. On a fresh email (not a
 * reply) Postmark sends StrippedTextReply as "", not absent.
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
  /** Base64 file contents, as Postmark's inbound stream sends them. */
  Attachments?: { Name?: string; Content?: string; ContentType?: string; ContentLength?: number }[];
}

/** Same ceiling the MMS path holds a photo or clip to. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * The photos and clips in an inbound email, the way an MMS carries them. A
 * signature logo or a PDF is not something to post, so only images and video
 * count, and tiny inline images (signature icons) are skipped.
 */
export function postableAttachments(
  atts: PostmarkInbound['Attachments'],
): { bytes: Buffer; contentType: string }[] {
  const out: { bytes: Buffer; contentType: string }[] = [];
  for (const a of atts ?? []) {
    const type = (a.ContentType ?? '').toLowerCase();
    if (!a.Content || !/^(image|video)\//.test(type)) continue;
    const bytes = Buffer.from(a.Content, 'base64');
    if (bytes.length < 10 * 1024 || bytes.length > MAX_ATTACHMENT_BYTES) continue;
    out.push({ bytes, contentType: type });
  }
  return out.slice(0, 10);
}

@Controller('webhooks/email')
export class EmailInboundController {
  private readonly log = new Logger(EmailInboundController.name);

  constructor(
    private readonly concierge: ConciergeService,
    private readonly storage: StorageService,
  ) {}

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
    const text = inboundText(body);
    // A photo emailed back is the email version of an MMS: store it where the
    // media pipeline can fetch it and hand it over like Twilio's media URLs.
    // Before this the attachment was dropped while the reply told the owner to
    // send a photo.
    const media = postableAttachments(body.Attachments);
    const mediaUrls: string[] = [];
    const mediaContentTypes: string[] = [];
    for (const m of media) {
      const key = `inbound-email/${randomUUID()}`;
      await this.storage.put(key, m.bytes, m.contentType);
      mediaUrls.push(this.storage.publicUrl(key));
      mediaContentTypes.push(m.contentType);
    }
    if (!text && !mediaUrls.length) {
      // Say so: a dropped email used to vanish without a trace in the logs.
      this.log.warn(`inbound email from ${from} had no text or photo — ignored`);
      return;
    }

    await this.concierge.handleInbound({
      from,
      body: text,
      mediaUrls,
      mediaContentTypes,
      // Postmark retries a delivery it thinks failed; the message id lets the
      // same duplicate guard that catches Twilio's retries catch these too.
      twilioSid: body.MessageID ? `email:${body.MessageID}` : undefined,
    });
  }
}

/**
 * The words of an inbound email. Postmark sends StrippedTextReply as "" on a
 * fresh email (only replies have quoted history to strip), and `??` keeps an
 * empty string — so the first email anyone sent us was read as blank and
 * silently dropped. Fall through on empty, ending with the subject for an
 * email that says everything in its subject line.
 */
export function inboundText(body: Pick<PostmarkInbound, 'StrippedTextReply' | 'TextBody' | 'Subject'>): string {
  return body.StrippedTextReply?.trim() || body.TextBody?.trim() || body.Subject?.trim() || '';
}
