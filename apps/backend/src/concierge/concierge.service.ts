import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Task } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { TwilioService } from './twilio.service';
import { OnboardingService } from './onboarding.service';
import { IntentService } from './intent.service';
import { LlmService } from '../operator/llm/llm.service';
import {
  formatInZone,
  inTextingWindow,
  nextTextingWindowOpen,
  tomorrowMorningInZone,
} from '../common/time';
import { z } from 'zod';

/** Shape of a grounded question-answer from the LLM. */
const AnswerOutput = z.object({ reply: z.string().min(1).max(600) });

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
    private readonly llm: LlmService,
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

    // 1b. Plan keywords — deterministic, stateless, and advertised in our own
    //     texts, so they must work even though they look like steady-state chat.
    const kw = msg.body.trim().toLowerCase();
    if (kw === 'upgrade') {
      const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
      return this.reply(
        customer.phone,
        conversation.id,
        `Happy to bump you up! Growth adds reels cut from your own clips, more posts, and more platforms — upgrade here: ${site}/billing`,
      );
    }
    if (kw === 'refer') {
      let code = customer.referralCode;
      if (!code) {
        code = customer.id.replace(/-/g, '').slice(0, 6).toUpperCase();
        await this.prisma.customer.update({
          where: { id: customer.id },
          data: { referralCode: code },
        });
      }
      const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
      return this.reply(
        customer.phone,
        conversation.id,
        `Know another owner who'd love this? Send them your link — when they join, you BOTH get a month free: ${site}/billing?ref=${code}`,
      );
    }
    if (kw === 'autopilot') {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { trustLevel: 'auto_low_risk' },
      });
      return this.reply(
        customer.phone,
        conversation.id,
        "Autopilot is on ✳ I'll post the routine stuff on schedule and only text you about promos, discounts, or anything sensitive. Reply MANUAL any time to go back to approving everything.",
      );
    }
    if (kw === 'manual') {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { trustLevel: 'approve_all' },
      });
      return this.reply(
        customer.phone,
        conversation.id,
        "Done — back to how it was: nothing goes out without your OK.",
      );
    }
    // RESET: wipe the brand profile and redo the interview from the top.
    // Scheduled posts stay put; only the profile (and its strategy) resets.
    if (kw === 'reset') {
      await this.prisma.brandProfile.updateMany({
        where: { customerId: customer.id },
        data: {
          businessType: null,
          voiceTone: null,
          targetCustomer: null,
          offers: [],
          dosAndDonts: [],
          postingFrequency: null,
          brandColors: [],
          visualStyle: null,
          contentStrategy: Prisma.DbNull,
          onboardingComplete: false,
        },
      });
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { status: 'onboarding', businessName: null },
      });
      return this.reply(
        customer.phone,
        conversation.id,
        `Fresh start ✳ Let's redo your profile from the top. ${this.onboarding.question('business_type')}`,
      );
    }
    // "can we restart" / "start over" — don't guess; confirm with the keyword.
    if (/\b(restart|start over|redo (my |the )?(profile|setup|onboarding)|from scratch)\b/i.test(msg.body)) {
      return this.reply(
        customer.phone,
        conversation.id,
        'Want me to rebuild your profile from scratch? Reply RESET and we start over — anything already scheduled stays put.',
      );
    }

    // 2. Media in → ingest each attachment, and aim it at whatever is waiting:
    //    the oldest open shot-list ask first, else the next upcoming post that
    //    has no photo yet. Without this linkage every photo landed as an
    //    orphan record and the "I'll need 1 quick photo" ask was never closed.
    if (msg.mediaUrls.length > 0) {
      let lastSummary = 'Got it — thanks for the photo! 📸';
      for (let i = 0; i < msg.mediaUrls.length; i++) {
        const openAsk = await this.prisma.shotListRequest.findFirst({
          where: { customerId: customer.id, status: 'requested' },
          orderBy: { askedAt: 'asc' },
        });
        const photolessPost = await this.prisma.post.findFirst({
          where: {
            customerId: customer.id,
            status: { in: ['pending_approval', 'approved', 'scheduled'] },
            mediaRefs: { isEmpty: true },
          },
          orderBy: { scheduledTime: 'asc' },
        });
        const result = await this.bus.emit(
          this.task(customer.id, 'INGEST_MEDIA', {
            source_url: msg.mediaUrls[i],
            content_type: msg.mediaContentTypes[i] ?? 'image/jpeg',
            shot_list_request_id: openAsk?.id,
            post_id: openAsk?.postId ?? photolessPost?.id,
          }),
        );
        lastSummary = result.summary_for_owner;
      }
      return this.reply(customer.phone, conversation.id, lastSummary);
    }

    // 3. Onboarding interview (§6) — resume at the next empty profile field.
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId: customer.id },
    });
    if (!this.onboarding.isComplete(profile)) {
      return this.continueOnboarding(customer.id, customer.phone, conversation.id, msg.body, profile, customer.businessName);
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
    // Oldest first: this is the one we last showed them, so "yes" resolves
    // the draft they are actually looking at.
    const pending = await this.prisma.post.findFirst({
      where: { customerId, status: 'pending_approval' },
      orderBy: { createdAt: 'asc' },
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
        // Keep the planned time if it has one; otherwise tomorrow 9am in the
        // business's own timezone.
        const cust = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { timezone: true },
        });
        const when =
          pending!.scheduledTime ??
          tomorrowMorningInZone(cust?.timezone ?? 'America/Los_Angeles');
        const result = await this.bus.emit(
          this.task(customerId, 'SCHEDULE_POST', {
            post_id: pending!.id,
            scheduled_time: when.toISOString(),
            owner_approved: true,
          }),
        );
        const more = await this.presentNextDraft(
          customerId,
          result.summary_for_owner,
          { promptedByOwner: true },
        );
        if (!more) {
          const offer = await this.trustRampOffer(customerId);
          await this.reply(
            phone,
            conversationId,
            `${result.summary_for_owner} That's everything for this week — I'll take it from here.${offer}`,
          );
        }
        return;
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
        const more = await this.presentNextDraft(
          customerId,
          result.summary_for_owner,
          { promptedByOwner: true },
        );
        if (!more) {
          await this.reply(
            phone,
            conversationId,
            `${result.summary_for_owner} Nothing else waiting on you.`,
          );
        }
        return;
      }

      case 'question':
        return this.answerQuestion(customerId, phone, conversationId, body, pending);

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

  /**
   * Text the owner unprompted — the weekly plan landing, a draft needing a
   * look. Everything else in here reacts to an inbound message; this is the
   * one path that starts a conversation, so it resolves (or creates) the
   * thread itself.
   */
  async notify(
    customerId: string,
    body: string,
    opts?: { promptedByOwner?: boolean },
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { conversation: true },
    });
    if (!customer) {
      this.log.warn(`notify: no customer ${customerId}`);
      return;
    }
    // Quiet hours (TCPA): unprompted texts only between 8:00 and 21:00 on the
    // owner's own clock. Outside that, hold it for the next window. Exempt:
    // anything the owner just asked for — a reply mid-conversation, an upload
    // confirmation, the welcome right after checkout. They're awake; answer.
    const now = new Date();
    if (!opts?.promptedByOwner && !inTextingWindow(now, customer.timezone)) {
      const sendAfter = nextTextingWindowOpen(now, customer.timezone);
      await this.prisma.queuedText.create({
        data: { customerId, body, sendAfter },
      });
      this.log.log(
        `quiet hours for ${customerId} (${customer.timezone}) — queued until ${sendAfter.toISOString()}`,
      );
      return;
    }
    const conversation =
      customer.conversation ??
      (await this.prisma.conversation.create({ data: { customerId } }));
    await this.reply(customer.phone, conversation.id, body);
  }

  /**
   * Send whatever the quiet-hours queue is holding, oldest first, once the
   * recipient's window is open. Called by cron every 15 minutes. A row whose
   * zone is somehow still outside the window (DST shifted overnight) is
   * re-queued for the next opening; rows for customers who stopped or
   * cancelled in the meantime are dropped unsent.
   */
  async flushQueuedTexts(): Promise<number> {
    const due = await this.prisma.queuedText.findMany({
      where: { sentAt: null, sendAfter: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      include: { customer: { include: { conversation: true } } },
    });
    let sent = 0;
    for (const item of due) {
      const customer = item.customer;
      if (!customer || !['active', 'onboarding'].includes(customer.status)) {
        await this.prisma.queuedText.delete({ where: { id: item.id } });
        this.log.log(
          `quiet-hours queue: dropped text for ${item.customerId} (status ${customer?.status ?? 'gone'})`,
        );
        continue;
      }
      const now = new Date();
      if (!inTextingWindow(now, customer.timezone)) {
        await this.prisma.queuedText.update({
          where: { id: item.id },
          data: { sendAfter: nextTextingWindowOpen(now, customer.timezone) },
        });
        continue;
      }
      const conversation =
        customer.conversation ??
        (await this.prisma.conversation.create({
          data: { customerId: customer.id },
        }));
      await this.reply(customer.phone, conversation.id, item.body);
      await this.prisma.queuedText.update({
        where: { id: item.id },
        data: { sentAt: new Date() },
      });
      sent++;
    }
    if (sent) this.log.log(`quiet-hours queue: sent ${sent}`);
    return sent;
  }

  /**
   * We initiate: the post-payment welcome, which doubles as onboarding Q1.
   * From here the owner's replies flow through the normal interview logic.
   */
  async beginOnboarding(customerId: string): Promise<void> {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    const first = this.onboarding.nextField(profile);
    if (!first) return; // already fully onboarded (re-subscribe, plan change)
    // The owner just checked out and is watching their phone for this text.
    await this.notify(
      customerId,
      first === 'business_type'
        ? this.onboarding.welcome()
        : this.onboarding.question(first),
      { promptedByOwner: true },
    );
  }

  /**
   * Show the owner the next draft waiting on them, oldest first. Drafts are a
   * queue worked one at a time — seven separate texts on a Monday morning is
   * how you get someone to reply STOP.
   *
   * Returns false when the queue is empty.
   */
  async presentNextDraft(
    customerId: string,
    lead?: string,
    opts?: { promptedByOwner?: boolean },
  ): Promise<boolean> {
    const [next, customer] = await Promise.all([
      this.prisma.post.findFirst({
        where: { customerId, status: 'pending_approval' },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { timezone: true },
      }),
    ]);
    if (!next) return false;

    const tz = customer?.timezone ?? 'America/Los_Angeles';
    const when = next.scheduledTime
      ? ` for ${formatInZone(next.scheduledTime, tz)}`
      : '';
    const body =
      (lead ? `${lead}\n\n` : '') +
      `Draft${when}:\n\n“${preview(next.caption ?? '')}”\n\n` +
      'Reply “yes” to schedule it, or tell me what to change.';
    await this.notify(customerId, body, opts);
    return true;
  }

  /**
   * A real answer to a real question — grounded in this customer's actual
   * state so the model can't invent features. Replaces the canned "Happy to
   * help!" that used to dead-end every question (and repeat itself).
   */
  private async answerQuestion(
    customerId: string,
    phone: string,
    conversationId: string,
    body: string,
    pending: { caption: string | null } | null,
  ): Promise<void> {
    const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
    try {
      const [profile, customer, openAsks] = await Promise.all([
        this.prisma.brandProfile.findUnique({ where: { customerId } }),
        this.prisma.customer.findUnique({ where: { id: customerId } }),
        this.prisma.shotListRequest.findMany({
          where: { customerId, status: 'requested' },
          orderBy: { askedAt: 'asc' },
          take: 3,
        }),
      ]);
      const facts = [
        `Business: ${customer?.businessName ?? 'not named'} — ${profile?.businessType ?? 'unknown'}.`,
        `Plan: ${customer?.planTier}, ${profile?.postingFrequency ?? 3} posts/week.`,
        pending
          ? `A draft is waiting for their approval (they reply "yes" to schedule it): "${(pending.caption ?? '').slice(0, 120)}"`
          : 'No drafts are waiting on them right now.',
        openAsks.length
          ? `Open photo/video asks they still owe: ${openAsks.map((a) => a.prompt).join(' | ')}. They upload at ${site}/upload?c=${customerId}`
          : 'No photo asks are open right now.',
        `They connect social accounts at ${site}/connect?c=${customerId} (we never see passwords).`,
        'Keywords that always work: STOP, HELP, UPGRADE, REFER, AUTOPILOT, MANUAL, RESET (redo profile).',
      ].join('\n');
      const { reply } = await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext:
            "You are Handled's SMS concierge — warm, plain-English, brief " +
            '(1-3 short sentences, this is a text message). Answer the ' +
            "owner's question using ONLY the facts provided. Never invent " +
            'features, prices, or dates. If the facts do not cover it, say ' +
            "you'll check and get back to them.",
          prompt: `FACTS:\n${facts}\n\nOwner's question: <<<${body.slice(0, 500)}>>>\n\nReturn JSON: {"reply": string}`,
          maxTokens: 300,
        },
        AnswerOutput,
      );
      return this.reply(phone, conversationId, reply);
    } catch (err) {
      this.log.warn(`answerQuestion fell back: ${String(err)}`);
      return this.reply(
        phone,
        conversationId,
        pending
          ? 'Good question — I\'ll get you an answer. Meanwhile that draft is ready whenever you are: reply "yes" to send it.'
          : "Good question — I'll check and get back to you. Anything you text me can also just become a post.",
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
    businessName?: string | null,
  ): Promise<void> {
    // First contact with just a hello → welcome + question one. But a first
    // message that actually describes the business IS the first answer —
    // throwing it away and greeting them anyway reads as not listening.
    const outboundCount = await this.prisma.message.count({
      where: { conversationId, direction: 'outbound' },
    });
    if (outboundCount === 0 && this.onboarding.isGreetingOnly(answer)) {
      return this.reply(phone, conversationId, this.onboarding.welcome());
    }

    // Interpret the answer to whichever field we asked about last (§6 — one
    // chatty answer may fill several fields; Haiku handles that when keyed,
    // deterministic parsing covers the asked field offline).
    const asked =
      outboundCount === 0
        ? ('business_type' as const)
        : this.onboarding.nextField(profile);
    let ack = '';
    if (asked) {
      const patch = await this.onboarding.interpret(
        asked,
        answer,
        profile,
        businessName,
      );
      // Belt and suspenders against re-emission: a "new" value identical to
      // what we already have is neither stored again nor re-acknowledged.
      if (patch.business_name && patch.business_name === businessName) {
        delete patch.business_name;
      }
      if (
        patch.brand_colors &&
        JSON.stringify(patch.brand_colors) ===
          JSON.stringify(profile?.brandColors ?? [])
      ) {
        delete patch.brand_colors;
      }
      if (Object.keys(patch).length > 0) {
        await this.bus.emit(
          this.task(customerId, 'UPDATE_BRAND_PROFILE', {
            patch,
            // Final answer → synthesize a durable voice from everything (§6).
            synthesize_voice: this.onboarding.wouldComplete(profile, patch),
          }),
        );
        ack = this.onboarding.ack(patch);
      } else {
        ack = "Sorry — didn't quite catch that.";
      }
    }

    // Ask the next empty field, or close out the interview.
    const fresh = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    const next = this.onboarding.nextField(fresh);
    if (next) {
      const q = this.onboarding.question(next);
      return this.reply(phone, conversationId, ack ? `${ack} ${q}` : q);
    }

    // Checklist complete → the customer is now live. Without this they stay
    // 'onboarding' forever and the weekly cron, which only sweeps active
    // customers, would silently never plan a week for them.
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { status: 'active' },
    });
    await this.prisma.brandProfile.updateMany({
      where: { customerId },
      data: { onboardingComplete: true },
    });

    // Read the profile back first — the cheapest way to catch a wrong
    // extraction is to say what we heard while the owner is still here.
    const done = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    const named = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { businessName: true },
    });
    if (done) {
      await this.reply(
        phone,
        conversationId,
        this.onboarding.summary(done, named?.businessName),
      );
    }

    // Send the connect link and kick off week 1 (§6).
    const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
    const result = await this.bus.emit(
      this.task(customerId, 'PLAN_WEEK', { week_start: nextMonday() }, 'concierge'),
    );
    await this.reply(
      phone,
      conversationId,
      `Next, whenever you have two minutes: connect the accounts you want ` +
        `me to post to (secure link, we never see your passwords): ` +
        `${site}/connect?c=${customerId}\n\nMeanwhile — ${result.summary_for_owner}`,
    );
  }

  /**
   * The trust ramp (§8): after enough approvals with zero cancellations, offer
   * autopilot once. Stateless — acceptance is the AUTOPILOT keyword, and the
   * offer only fires while still on approve_all, so it can't nag forever.
   */
  private async trustRampOffer(customerId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { trustLevel: true },
    });
    if (customer?.trustLevel !== 'approve_all') return '';
    const [approved, rejected] = await Promise.all([
      this.prisma.post.count({
        where: { customerId, approvalState: 'approved' },
      }),
      this.prisma.post.count({
        where: { customerId, approvalState: 'rejected' },
      }),
    ]);
    // 10 green lights and fewer than 1-in-5 skips = they trust the output.
    if (approved < 10 || rejected * 5 > approved) return '';
    return (
      "\n\nBy the way — you've approved everything I've sent for a while now. " +
      'Want me to put the routine posts on autopilot and only check with you ' +
      'on promos and anything sensitive? Reply AUTOPILOT to switch it on.'
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

/** Keep SMS short — Result.summary_for_owner caps at 480 chars total. */
function preview(caption: string): string {
  const flat = caption.replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? `${flat.slice(0, 177)}…` : flat;
}

function nextMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
