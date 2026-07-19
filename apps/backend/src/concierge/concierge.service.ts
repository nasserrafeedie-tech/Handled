import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Task } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { TwilioService } from './twilio.service';
import { OnboardingService } from './onboarding.service';
import { IntentService } from './intent.service';

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
    private readonly intent: IntentService,
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

    // 4. Graphic request ("make a graphic/carousel/quote card/promo...").
    if (this.isGraphicRequest(msg.body)) {
      const slides = buildSlidesFromText(msg.body);
      const result = await this.bus.emit(
        this.task(customer.id, 'MAKE_GRAPHIC', { slides }),
      );
      return this.reply(customer.phone, conversation.id, result.summary_for_owner);
    }

    // 5. Steady-state loop (§6): approve / revise / cancel / question.
    return this.handleSteadyState(customer.id, customer.phone, conversation.id, msg.body);
  }

  /**
   * The everyday conversation. Almost always the owner is reacting to a draft
   * we texted them, so we resolve "the post they mean" first — the one still
   * waiting on their OK — then act on what they said.
   */
  private async handleSteadyState(
    customerId: string,
    phone: string,
    conversationId: string,
    body: string,
  ): Promise<void> {
    const pending = await this.prisma.post.findFirst({
      where: { customerId, status: 'pending_approval' },
      orderBy: { createdAt: 'desc' },
    });

    const { intent, feedback } = await this.intent.classify(body, Boolean(pending));

    // Nothing waiting on them — don't pretend we changed something.
    if (!pending && (intent === 'approve' || intent === 'revise' || intent === 'cancel')) {
      return this.reply(
        phone,
        conversationId,
        "Nothing's waiting on your OK right now — I'll text you as soon as your next post is ready.",
      );
    }

    switch (intent) {
      case 'approve': {
        // Keep the planned time if it has one; otherwise go out tomorrow 9am.
        const when = pending!.scheduledTime ?? tomorrowMorning();
        const result = await this.bus.emit(
          this.task(customerId, 'SCHEDULE_POST', {
            post_id: pending!.id,
            scheduled_time: when.toISOString(),
            owner_approved: true,
          }),
        );
        return this.reply(phone, conversationId, result.summary_for_owner);
      }

      case 'revise': {
        const result = await this.bus.emit(
          this.task(customerId, 'REGENERATE_POST', {
            post_id: pending!.id,
            owner_feedback: feedback?.slice(0, 1000) || body.slice(0, 1000),
            regenerate_caption: true,
            regenerate_media: false,
          }),
        );
        return this.reply(phone, conversationId, result.summary_for_owner);
      }

      case 'cancel': {
        const result = await this.bus.emit(
          this.task(customerId, 'CANCEL_POST', {
            post_id: pending!.id,
            reason: 'owner declined over SMS',
          }),
        );
        return this.reply(phone, conversationId, result.summary_for_owner);
      }

      case 'question':
        return this.reply(
          phone,
          conversationId,
          pending
            ? "Happy to help — and whenever you're ready, just reply “yes” to send that draft out."
            : "Happy to help! Ask away, or text me anything you'd like posted this week.",
        );

      default:
        return this.reply(
          phone,
          conversationId,
          pending
            ? "Got it. Reply “yes” to send that draft, or tell me what you'd like changed."
            : "Got it — I'll keep that in mind. Text me any time you want something posted.",
        );
    }
  }

  private isGraphicRequest(body: string): boolean {
    return /\b(graphic|carousel|slide|quote card|quote graphic|promo|flyer|make (?:me )?a post)\b/i.test(
      body,
    );
  }

  private async continueOnboarding(
    customerId: string,
    phone: string,
    conversationId: string,
    answer: string,
    profile: Awaited<ReturnType<PrismaService['brandProfile']['findUnique']>>,
  ): Promise<void> {
    // First contact: we haven't asked anything yet, so this message ("hi",
    // "I just signed up") isn't an answer. Welcome them and ask question one.
    const outboundCount = await this.prisma.message.count({
      where: { conversationId, direction: 'outbound' },
    });
    if (outboundCount === 0) {
      const first = this.onboarding.nextField(profile)!;
      return this.reply(phone, conversationId, this.onboarding.question(first, profile));
    }

    // Interpret the answer to whichever field we asked about last (§6 — one
    // chatty answer may fill several fields; Haiku handles that when keyed,
    // deterministic parsing covers the asked field offline).
    const asked = this.onboarding.nextField(profile);
    if (asked) {
      const patch = await this.onboarding.interpret(asked, answer, profile);
      if (Object.keys(patch).length > 0) {
        await this.bus.emit(
          this.task(customerId, 'UPDATE_BRAND_PROFILE', {
            patch,
            // Final answer → synthesize a durable voice from everything (§6).
            synthesize_voice: this.onboarding.wouldComplete(profile, patch),
          }),
        );
      }
    }

    // Ask the next empty field, or close out the interview.
    const fresh = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    const next = this.onboarding.nextField(fresh);
    if (next) {
      return this.reply(phone, conversationId, this.onboarding.question(next, fresh));
    }

    // Checklist complete → send the connect link and kick off week 1 (§6).
    const site = process.env.PUBLIC_SITE_URL ?? 'https://aissm-web.vercel.app';
    const result = await this.bus.emit(
      this.task(customerId, 'PLAN_WEEK', { week_start: nextMonday() }, 'concierge'),
    );
    await this.reply(
      phone,
      conversationId,
      `That's everything I need ✳ One last thing, whenever you have two ` +
        `minutes: connect the accounts you want me to post to (secure link, ` +
        `we never see your passwords): ${site}/connect?c=${customerId}` +
        `\n\nMeanwhile — ${result.summary_for_owner}`,
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

/**
 * Turn a free-text graphic request into slide specs. Deterministic heuristics
 * for the common asks (promo with a discount, a quote card, or a simple
 * title+body). The Haiku intent step can later replace this with richer parsing.
 */
export function buildSlidesFromText(
  body: string,
): { kind: 'title' | 'body' | 'quote' | 'promo' | 'cta'; headline: string; body?: string; footer?: string }[] {
  const text = body.trim();

  // Quote card: text inside quotation marks.
  const quote = /["“](.+?)["”]/.exec(text);
  if (quote && /quote/i.test(text)) {
    return [{ kind: 'quote', headline: quote[1] }];
  }

  // Promo: a percentage or "$X off" / "sale".
  const pct = /(\d{1,3})\s*%\s*off/i.exec(text);
  const dollar = /\$\s?(\d+)\s*off/i.exec(text);
  if (pct || dollar || /\bsale\b/i.test(text)) {
    const headline = pct
      ? `${pct[1]}% OFF`
      : dollar
        ? `$${dollar[1]} OFF`
        : 'SALE';
    return [{ kind: 'promo', headline, body: stripCommand(text) }];
  }

  // Default: a title slide from the request text.
  const headline = stripCommand(text) || 'New Post';
  return [{ kind: 'title', headline }];
}

/** Remove the leading "make a graphic/carousel ... that says/about" command. */
function stripCommand(text: string): string {
  return text
    .replace(
      /^\s*(please\s+)?(make|create|build|design)\s+(me\s+)?a\s+(graphic|carousel|slide|quote card|promo(?:\s+post|\s+graphic)?|flyer|post)\s*(that says|saying|about|for|:)?\s*/i,
      '',
    )
    .replace(/^["“]|["”]$/g, '')
    .trim();
}

/** Default send time when an approved draft has no planned slot. */
function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function nextMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
