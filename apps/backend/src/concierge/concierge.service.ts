import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Task } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { TwilioService } from './twilio.service';
import { OnboardingService } from './onboarding.service';

export interface InboundSms {
  from: string; // E.164
  body: string;
  mediaUrls: string[];
  mediaContentTypes: string[];
  twilioSid?: string;
}

/**
 * Agent A (§6). Turns an inbound SMS into intent, emits exactly one Task via the
 * TaskBus, and replies to the owner. It holds no keys and never calls posting or
 * image APIs directly — that is the Operator's job.
 *
 * Deterministic intents (kill switch, media ingest, onboarding routing) are
 * handled here explicitly. Nuanced free-text intent (approve / edit / question)
 * is where the Haiku intent step plugs in (seam marked below).
 */
@Injectable()
export class ConciergeService {
  private readonly log = new Logger(ConciergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: TaskBus,
    private readonly twilio: TwilioService,
    private readonly onboarding: OnboardingService,
  ) {}

  async handleInbound(msg: InboundSms): Promise<void> {
    const { customer, conversation } = await this.resolveCustomer(msg.from);
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        body: msg.body,
        mediaUrls: msg.mediaUrls,
        twilioSid: msg.twilioSid,
      },
    });

    // 1. Kill switch (§8) — highest priority, dead simple.
    if (this.isStop(msg.body)) {
      const result = await this.bus.emit(
        this.task(customer.id, 'PAUSE_CUSTOMER', { reason: 'owner_stop', resume: false }),
      );
      return this.reply(customer.phone, conversation.id, result.summary_for_owner);
    }

    // 2. Media in → ingest each attachment.
    if (msg.mediaUrls.length > 0) {
      for (let i = 0; i < msg.mediaUrls.length; i++) {
        await this.bus.emit(
          this.task(customer.id, 'INGEST_MEDIA', {
            source_url: msg.mediaUrls[i],
            content_type: msg.mediaContentTypes[i] ?? 'image/jpeg',
          }),
        );
      }
      return this.reply(customer.phone, conversation.id, 'Got it — thanks for the photo! 📸');
    }

    // 3. Onboarding interview (§6) — resume at the next empty profile field.
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId: customer.id },
    });
    if (!this.onboarding.isComplete(profile)) {
      return this.continueOnboarding(customer.id, customer.phone, conversation.id, msg.body, profile);
    }

    // 4. Steady-state intent (approve / regenerate / question).
    //    Integration point: Haiku intent classification → emit the right Task.
    //    Until wired, acknowledge so the owner is never left hanging.
    await this.reply(
      customer.phone,
      conversation.id,
      "Thanks! I'll take a look and get back to you.",
    );
  }

  private async continueOnboarding(
    customerId: string,
    phone: string,
    conversationId: string,
    answer: string,
    profile: Awaited<ReturnType<PrismaService['brandProfile']['findUnique']>>,
  ): Promise<void> {
    // Integration point: interpret `answer` with Haiku (it may fill several
    // fields at once, §6) and emit UPDATE_BRAND_PROFILE with the patch +
    // synthesize_voice on the final field. Here we advance the checklist.
    const nextField = this.onboarding.nextField(profile);

    if (nextField) {
      const q = this.onboarding.question(nextField, profile);
      return this.reply(phone, conversationId, q);
    }

    // Just became complete → kick off week 1 (§6 closing step).
    const result = await this.bus.emit(
      this.task(customerId, 'PLAN_WEEK', { week_start: nextMonday() }, 'concierge'),
    );
    await this.reply(
      phone,
      conversationId,
      `Perfect — that's everything I need. ${result.summary_for_owner}`,
    );
  }

  private async resolveCustomer(phone: string) {
    let customer = await this.prisma.customer.findUnique({
      where: { phone },
      include: { conversation: true },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          phone,
          conversation: { create: {} },
          brandProfile: { create: {} },
        },
        include: { conversation: true },
      });
    }
    const conversation =
      customer.conversation ??
      (await this.prisma.conversation.create({ data: { customerId: customer.id } }));
    return { customer, conversation };
  }

  private async reply(phone: string, conversationId: string, body: string): Promise<void> {
    await this.twilio.send(phone, body);
    await this.prisma.message.create({
      data: { conversationId, direction: 'outbound', body },
    });
  }

  private isStop(body: string): boolean {
    return /^\s*(stop|pause|cancel|halt)\b/i.test(body);
  }

  private task(
    customerId: string,
    type: Task['type'],
    payload: unknown,
    createdBy: 'concierge' | 'cron' = 'concierge',
  ): Task {
    return {
      task_id: randomUUID(),
      customer_id: customerId,
      type,
      payload,
      requires_approval: false,
      created_by: createdBy,
      created_at: new Date().toISOString(),
    } as Task;
  }
}

function nextMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
