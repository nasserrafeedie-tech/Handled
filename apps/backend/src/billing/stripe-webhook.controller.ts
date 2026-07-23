import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  Req,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { Task } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { ConciergeService } from '../concierge/concierge.service';
import type { PlanId } from './billing.service';
import { normalizePhone } from '../common/phone';

/**
 * Plan order, for telling an upgrade from a downgrade. Only used to decide
 * whether to say anything — never to gate a feature.
 */
const RANK: Record<string, number> = { starter: 0, growth: 1, pro: 2 };

interface StripeEvent {
  id?: string;
  type: string;
  data: {
    object: {
      customer?: string;
      metadata?: Record<string, string>;
      customer_details?: { phone?: string; email?: string };
      /** subscription.updated — what they are on NOW. */
      items?: { data?: { price?: { id?: string } }[] };
      /**
       * invoice.payment_failed — the next retry Stripe will make, or null when
       * it has given up. Null is the difference between "their card hiccuped"
       * and "this customer is not paying us any more".
       */
      next_payment_attempt?: number | null;
    };
  };
}

/**
 * The front door (§2). Until this existed, Stripe checkout completed into a
 * void: money taken, no customer created, no first text — the website and the
 * SMS product never touched. Now payment → customer record → Handled opens the
 * onboarding conversation.
 *
 * Signature model mirrors the Twilio webhook: fail CLOSED in production when
 * STRIPE_WEBHOOK_SECRET is missing, permissive locally so tests can drive it.
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly log = new Logger(StripeWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: TaskBus,
    private readonly concierge: ConciergeService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    if (!this.verify(req.rawBody, signature)) {
      throw new ForbiddenException('invalid Stripe signature');
    }

    const event = JSON.parse((req.rawBody ?? Buffer.from('{}')).toString()) as StripeEvent;

    if (!(await this.claim(event))) {
      // Already handled. Answer 200 so Stripe stops retrying.
      this.log.debug(`duplicate stripe event ${event.id} — skipping`);
      return { received: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event);
        break;
      default:
        this.log.debug(`ignoring stripe event ${event.type}`);
    }
    return { received: true };
  }

  /**
   * Take this event, once. Stripe redelivers on any timeout or non-2xx, so
   * without a claim a slow response means onboarding runs twice and the new
   * customer is welcomed to Handled twice in a row.
   *
   * The insert IS the lock — a duplicate id violates the primary key and we
   * skip. Checking first and writing after would leave a window where two
   * concurrent deliveries both read "not seen" and both proceed.
   */
  private async claim(event: StripeEvent): Promise<boolean> {
    if (!event.id) {
      // No id to dedupe on. Process it rather than drop it: a repeated welcome
      // text is a bad day, a dropped payment is a lost customer.
      this.log.warn('stripe event with no id — processing without dedupe');
      return true;
    }
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: { id: event.id, type: event.type },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Plan changed — usually an upgrade through Stripe's billing portal, which
   * never touches our checkout flow and so was previously invisible.
   *
   * This is the whole reason it matters: planTier gates carousels, generated
   * images and reels. A Starter customer who upgrades to Growth and stays
   * recorded as Starter pays $349 for $95 of product, and the missing feature
   * is the exact one they upgraded to get. Nothing errors; they just quietly
   * never receive it.
   */
  private async onSubscriptionUpdated(event: StripeEvent): Promise<void> {
    const obj = event.data.object;
    const stripeCustomerId = obj.customer;
    if (!stripeCustomerId) return;

    const priceId = obj.items?.data?.[0]?.price?.id;
    const plan = this.planForPrice(priceId);
    if (!plan) {
      this.log.error(
        `subscription updated to unrecognized price "${priceId}" — plan tier ` +
          'left unchanged. Check STRIPE_PRICE_* match the prices in Stripe.',
      );
      return;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { stripeCustomerId },
    });
    if (!customer) {
      this.log.warn(`subscription updated for unknown stripe customer ${stripeCustomerId}`);
      return;
    }
    if (customer.planTier === plan) return;

    const from = customer.planTier;
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { planTier: plan },
    });
    this.log.log(`customer ${customer.id}: plan ${from} → ${plan}`);

    // Only speak up on an upgrade. A downgrade is a decision they already made
    // and being congratulated on losing features reads as tone-deaf.
    if (RANK[plan] > RANK[from]) {
      await this.concierge.notify(
        customer.id,
        "You're on the new plan — carousels are switched on, and you'll see " +
          "them in this week's posts. Nothing else changes.",
      );
    }
  }

  /** Which plan does this Stripe price belong to? */
  private planForPrice(priceId: string | undefined): PlanId | undefined {
    if (!priceId) return undefined;
    const map: Record<string, PlanId> = {};
    if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = 'starter';
    if (process.env.STRIPE_PRICE_GROWTH) map[process.env.STRIPE_PRICE_GROWTH] = 'growth';
    if (process.env.STRIPE_PRICE_PRO) map[process.env.STRIPE_PRICE_PRO] = 'pro';
    return map[priceId];
  }

  /**
   * A payment failed. Stripe retries over several days before giving up, so the
   * response depends on which of those we are looking at.
   *
   * Without this, a declined card meant Handled kept writing and publishing
   * indefinitely for someone who had stopped paying — a full-price service
   * delivered free, with nothing anywhere in the system aware of it.
   */
  private async onPaymentFailed(event: StripeEvent): Promise<void> {
    const obj = event.data.object;
    const stripeCustomerId = obj.customer;
    if (!stripeCustomerId) return;

    const customer = await this.prisma.customer.findFirst({
      where: { stripeCustomerId },
    });
    if (!customer) {
      this.log.warn(`payment failed for unknown stripe customer ${stripeCustomerId}`);
      return;
    }

    const willRetry = Boolean(obj.next_payment_attempt);
    if (willRetry) {
      // Still recoverable. Tell them plainly and keep posting — cutting service
      // over a card that expired last night would lose a customer we still have.
      this.log.warn(`payment failed for ${customer.id}, Stripe will retry`);
      await this.concierge.notify(
        customer.id,
        "Heads up — your card was declined, so this month's payment didn't go " +
          "through. I'll keep posting as normal and try again in a few days. " +
          'You can update your card any time and it sorts itself out.',
      );
      return;
    }

    // Stripe has stopped trying. Stop delivering.
    this.log.error(`payment permanently failed for ${customer.id} — pausing`);
    await this.bus.emit({
      task_id: randomUUID(),
      customer_id: customer.id,
      type: 'PAUSE_CUSTOMER',
      payload: { reason: 'billing', resume: false },
      requires_approval: false,
      created_by: 'concierge',
      created_at: new Date().toISOString(),
    } as Task);
    await this.concierge.notify(
      customer.id,
      "I wasn't able to process your payment, so I've paused your posts for " +
        'now — nothing will go out. Update your card and text me, and I\'ll ' +
        'pick straight back up where we left off.',
    );
  }

  /** Payment landed → create the customer and open the conversation. */
  private async onCheckoutCompleted(event: StripeEvent): Promise<void> {
    const obj = event.data.object;
    // Normalize before anything touches the database. Phone IS the account key,
    // and Stripe's formatting is not ours to assume — a customer who already
    // exists (signed up in person, connected their Instagram, mid-onboarding)
    // must resolve to that same row. Upserting on a raw string instead creates a
    // SECOND customer: the new one holds the plan they just paid for, the
    // original holds their connected account and brand profile, and neither is
    // whole. Every other way into this table normalizes; so does this one.
    const rawPhone = obj.customer_details?.phone;
    const phone = normalizePhone(rawPhone);
    const plan = obj.metadata?.plan ?? 'starter';
    if (rawPhone && !phone) {
      this.log.error(
        `checkout.session.completed with an unusable phone "${rawPhone}" — ` +
          'refusing to create a customer we cannot text or match',
      );
      return;
    }
    if (!phone) {
      // Phone collection is enabled on our sessions, so this is a config
      // regression worth shouting about — it means a paying customer we
      // cannot reach.
      this.log.error('checkout.session.completed WITHOUT a phone — cannot start onboarding');
      return;
    }

    const customer = await this.prisma.customer.upsert({
      where: { phone },
      create: {
        phone,
        planTier: plan,
        stripeCustomerId: obj.customer ?? null,
        conversation: { create: {} },
        brandProfile: { create: {} },
      },
      update: {
        planTier: plan,
        stripeCustomerId: obj.customer ?? undefined,
      },
    });
    this.log.log(`checkout complete: ${customer.id} on ${plan}`);

    // Referral credit: thank the referrer, remember who sent them. The actual
    // billing credit is applied manually in Stripe for now — the important
    // part is that neither side's goodwill falls on the floor.
    const ref = obj.metadata?.ref;
    if (ref) {
      const referrer = await this.prisma.customer.findUnique({
        where: { referralCode: ref },
      });
      if (referrer && referrer.id !== customer.id) {
        await this.prisma.customer.update({
          where: { id: customer.id },
          data: { referredByCode: ref },
        });
        await this.concierge.notify(
          referrer.id,
          'Your referral just joined 🎉 A free month is coming off your next bill — thank you for spreading the word!',
        );
      }
    }

    // First text goes out from us — the welcome doubles as onboarding Q1.
    await this.concierge.beginOnboarding(customer.id);
  }

  /** Subscription gone → stop publishing immediately, say goodbye kindly. */
  private async onSubscriptionDeleted(event: StripeEvent): Promise<void> {
    const stripeCustomerId = event.data.object.customer;
    if (!stripeCustomerId) return;
    const customer = await this.prisma.customer.findFirst({
      where: { stripeCustomerId },
    });
    if (!customer) {
      this.log.warn(`subscription deleted for unknown stripe customer ${stripeCustomerId}`);
      return;
    }
    await this.bus.emit({
      task_id: randomUUID(),
      customer_id: customer.id,
      type: 'PAUSE_CUSTOMER',
      payload: { reason: 'billing', resume: false },
      requires_approval: false,
      created_by: 'concierge',
      created_at: new Date().toISOString(),
    } as Task);
    await this.concierge.notify(
      customer.id,
      "Your subscription has ended, so I've paused all posting — nothing will go out. If you ever want to pick things back up, I'm one text away. Thank you for letting me run your social media 💛",
    );
  }

  /**
   * Stripe-Signature: t=<unix>,v1=<hmac-sha256 of "<t>.<rawBody>">.
   * Missing secret: reject in production (loud outage beats silently trusting
   * anyone who finds the URL), allow in dev for the offline test harness.
   */
  private verify(rawBody: Buffer | undefined, header: string | undefined): boolean {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('STRIPE_WEBHOOK_SECRET is not set — refusing webhook.');
        return false;
      }
      this.log.warn('No STRIPE_WEBHOOK_SECRET (dev) — skipping signature check');
      return true;
    }
    if (!rawBody || !header) return false;

    const parts = Object.fromEntries(
      header.split(',').map((kv) => kv.split('=') as [string, string]),
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;
    // 5-minute replay window, same tolerance Stripe's own SDK uses.
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

    const expected = createHmac('sha256', secret)
      .update(`${t}.${rawBody.toString()}`)
      .digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    } catch {
      return false;
    }
  }
}
