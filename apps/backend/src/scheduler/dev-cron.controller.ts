import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
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
 *     -H 'content-type: application/json' -d '{"from":"+14245550199"}'
 *
 * Lives in the scheduler module (not alongside the SMS simulator) because the
 * scheduler already depends on the Concierge — putting it the other way round
 * would make the two modules import each other.
 *
 * Hidden in production unless ALLOW_DEV_SMS=1.
 */
@Controller('dev')
export class DevCronController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronService,
  ) {}

  @Post('run-recap')
  async runRecap(@Body() body: unknown): Promise<{ ok: boolean }> {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SMS !== '1') {
      throw new NotFoundException();
    }
    const { from } = RunWeekBody.parse(body);
    const customer = await this.prisma.customer.findUnique({ where: { phone: from } });
    if (!customer) throw new NotFoundException();
    await this.cron.sendRecap(customer.id);
    return { ok: true };
  }

  @Post('flush-texts')
  async flushTexts(): Promise<{ sent: number }> {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SMS !== '1') {
      throw new NotFoundException();
    }
    return { sent: await this.cron.flushQueuedTextsNow() };
  }

  @Post('run-week')
  async runWeek(
    @Body() body: unknown,
  ): Promise<{ drafted: number; texts: string[] }> {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_DEV_SMS !== '1'
    ) {
      throw new NotFoundException();
    }

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
