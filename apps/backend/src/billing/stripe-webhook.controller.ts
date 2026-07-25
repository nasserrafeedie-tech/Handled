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
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { ConciergeService } from '../concierge/concierge.service';
import type { PlanId } from './billing.service';
import { normalizePhone } from '../common/phone';
import { platformLimit } from '../operator/tier-entitlements';

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

    try {
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
    } catch (e) {
      // The handler failed AFTER we claimed the event. If the claim stood, the
      // claim would make Stripe's retry look like a duplicate and the side
      // effect — onboarding a paying customer, applying an upgrade, pausing a
      // deadbeat — would be lost forever. Release the claim so the redelivery
      // runs it again, then rethrow so Stripe sees a 500 and does retry.
      // Handlers are written to be safe to re-run (upsert, findFirst-then-set).
      await this.releaseClaim(event.id);
      throw e;
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
    } catch (e) {
      // ONLY a unique-key violation means "already seen" → skip. Any other
      // error (a connection blip, a pool timeout) is transient: treating it as
      // a duplicate would drop a brand-new event as if handled. Rethrow those
      // so Stripe retries instead of losing the event silently.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return false;
      }
      throw e;
    }
  }

  /** Undo a claim when its handler failed, so the retry is honoured. */
  private async releaseClaim(id: string | undefined): Promise<void> {
    if (!id) return;
    try {
      await this.prisma.stripeWebhookEvent.delete({ where: { id } });
    } catch {
      // Best-effort. If the delete fails the event stays claimed and the retry
      // is skipped — no worse than before this method existed, and rare.
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

    // On a downgrade, enforce the new tier's platform cap. Feature gates
    // (carousels/images/reels) re-evaluate per post, but platform reach is only
    // ever checked at connect time, so without this a Pro→Starter customer keeps
    // publishing to all their platforms — paid reach they no longer pay for.
    // Keep the oldest connections (the primary accounts), revoke the rest.
    if (RANK[plan] < RANK[from]) {
      const limit = platformLimit(plan);
      const connected = await this.prisma.connectedAccount.findMany({
        where: { customerId: customer.id, revoked: false },
        orderBy: { connectedAt: 'asc' },
        select: { id: true },
      });
      const toRevoke = connected.slice(limit);
      if (toRevoke.length) {
        await this.prisma.connectedAccount.updateMany({
          where: { id: { in: toRevoke.map((r) => r.id) } },
          data: { revoked: true },
        });
        this.log.log(
          `downgrade ${from}→${plan}: revoked ${toRevoke.length} platform(s) over the ${plan} limit of ${limit} for ${customer.id}`,
        );
      }
    }

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

    // The header can carry MORE THAN ONE v1 signature — during a webhook-secret
    // rotation Stripe signs with both the old and new secret. Collect every t
    // and every v1 rather than keeping just the last, or a valid webhook gets
    // rejected 403 for the whole rotation window.
    let t: string | undefined;
    const sigs: string[] = [];
    for (const kv of header.split(',')) {
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const key = kv.slice(0, eq);
      const val = kv.slice(eq + 1);
      if (key === 't') t = val;
      else if (key === 'v1') sigs.push(val);
    }
    if (!t || sigs.length === 0) return false;
    // 5-minute replay window, same tolerance Stripe's own SDK uses.
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

    const expected = createHmac('sha256', secret)
      .update(`${t}.${rawBody.toString()}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expected);
    return sigs.some((sig) => {
      try {
        return timingSafeEqual(expectedBuf, Buffer.from(sig));
      } catch {
        return false;
      }
    });
  }
}
