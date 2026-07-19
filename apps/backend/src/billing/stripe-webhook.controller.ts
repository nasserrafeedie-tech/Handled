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

interface StripeEvent {
  type: string;
  data: {
    object: {
      customer?: string;
      metadata?: Record<string, string>;
      customer_details?: { phone?: string; email?: string };
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

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event);
        break;
      default:
        this.log.debug(`ignoring stripe event ${event.type}`);
    }
    return { received: true };
  }

  /** Payment landed → create the customer and open the conversation. */
  private async onCheckoutCompleted(event: StripeEvent): Promise<void> {
    const obj = event.data.object;
    const phone = obj.customer_details?.phone;
    const plan = obj.metadata?.plan ?? 'starter';
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
