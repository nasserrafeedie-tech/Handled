import {
  Body,
  Controller,
  Headers,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { CronService } from './cron.service';

const RunWeekBody = z.object({
  from: z.string().min(3).describe('customer phone, e.g. +14245550199'),
});

/**
 * Fires a customer's Monday morning on demand so the weekly rhythm can be
 * watched end to end without waiting for the cron:
 *
 *   curl -X POST localhost:3001/dev/run-week \
 *     -H 'x-admin-token: ...' -H 'content-type: application/json' \
 *     -d '{"from":"+14245550199"}'
 *
 * Lives in the scheduler module (not alongside the SMS simulator) because the
 * scheduler already depends on the Concierge — putting it the other way round
 * would make the two modules import each other.
 *
 * Hidden in production unless ALLOW_DEV_SMS=1 — and even then it demands the
 * admin token, exactly like /dev/sms. These endpoints trigger real LLM drafting
 * (run-week burns token budget on demand for any customer by phone) and send
 * texts, so ALLOW_DEV_SMS alone opening them to anyone is a hole. The flag and
 * the token were kept in step on /dev/sms; they must stay in step here too.
 */
@Controller('dev')
export class DevCronController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronService,
  ) {}

  /**
   * In production: the dev flag must be on AND the admin token must match.
   * Outside production the endpoints stay open so local dev needs no token.
   */
  private assertDevAllowed(token: string | undefined): void {
    if (process.env.NODE_ENV !== 'production') return;
    if (process.env.ALLOW_DEV_SMS !== '1') throw new NotFoundException();
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();
  }

  @Post('run-recap')
  async runRecap(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean; texts: string[] }> {
    this.assertDevAllowed(token);
    const { from } = RunWeekBody.parse(body);
    const customer = await this.prisma.customer.findUnique({
      where: { phone: from },
      include: { conversation: true },
    });
    if (!customer) throw new NotFoundException();

    // Return what the recap actually said, the same way run-week does. The
    // recap is composed by the scheduler and lands in the outbox, which prod
    // gates off unless SMS_MANUAL_RELAY=1 — so without this a tester gets {ok}
    // and no way to read the text they just generated.
    const t0 = new Date();
    await this.cron.sendRecap(customer.id);
    const texts = customer.conversation
      ? await this.prisma.message.findMany({
          where: {
            conversationId: customer.conversation.id,
            direction: 'outbound',
            createdAt: { gte: t0 },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    return { ok: true, texts: texts.map((m) => m.body ?? '') };
  }

  @Post('flush-texts')
  async flushTexts(
    @Headers('x-admin-token') token: string | undefined,
  ): Promise<{ sent: number }> {
    this.assertDevAllowed(token);
    return { sent: await this.cron.flushQueuedTextsNow() };
  }

  @Post('run-week')
  async runWeek(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ drafted: number; texts: string[] }> {
    this.assertDevAllowed(token);

    const { from } = RunWeekBody.parse(body);
    const customer = await this.prisma.customer.findUnique({
      where: { phone: from },
      include: { conversation: true },
    });
    if (!customer) throw new NotFoundException(`no customer for ${from}`);

    const t0 = new Date();
    const drafted = await this.cron.runWeeklyRhythm(customer.id);

    const texts = customer.conversation
      ? await this.prisma.message.findMany({
          where: {
            conversationId: customer.conversation.id,
            direction: 'outbound',
            createdAt: { gte: t0 },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    return { drafted, texts: texts.map((m) => m.body ?? '') };
  }
}
