import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ConciergeService } from './concierge.service';

const SimBody = z.object({
  from: z.string().min(3).describe('phone number, e.g. +15551234567'),
  body: z.string().default(''),
  /** Simulate MMS attachments (any URL works offline). */
  mediaUrls: z.array(z.string().url()).default([]),
});

/**
 * SMS simulator for development. Lets us drive the whole Concierge — including
 * the onboarding interview — with curl while Twilio A2P approval is pending:
 *
 *   curl -X POST localhost:3001/dev/sms \
 *     -H 'content-type: application/json' \
 *     -d '{"from":"+15551234567","body":"hi"}'
 *
 * Returns whatever the Concierge texted back. Hidden in production unless
 * ALLOW_DEV_SMS=1 is set explicitly.
 */
@Controller('dev')
export class DevSmsController {
  constructor(
    private readonly concierge: ConciergeService,
    private readonly prisma: PrismaService,
  ) {}

  /** Both dev endpoints stay invisible in production unless explicitly opened. */
  private assertDevAllowed(): void {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_DEV_SMS !== '1'
    ) {
      throw new NotFoundException();
    }
  }

  @Post('sms')
  async simulate(@Body() body: unknown): Promise<{ replies: string[] }> {
    this.assertDevAllowed();
    const { from, body: text, mediaUrls } = SimBody.parse(body);
    const t0 = new Date();

    await this.concierge.handleInbound({
      from,
      body: text,
      mediaUrls,
      mediaContentTypes: mediaUrls.map(() => 'image/jpeg'),
    });

    // Echo back what the Concierge sent since t0, in order.
    const customer = await this.prisma.customer.findUnique({
      where: { phone: from },
      include: { conversation: true },
    });
    if (!customer?.conversation) return { replies: [] };
    const outbound = await this.prisma.message.findMany({
      where: {
        conversationId: customer.conversation.id,
        direction: 'outbound',
        createdAt: { gte: t0 },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { replies: outbound.map((m) => m.body ?? '') };
  }
}
