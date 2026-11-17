import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { BillingService, type PlanId } from './billing.service';

const PortalBody = z.object({ t: z.string().max(300) });

const CheckoutBody = z.object({
  plan: z.enum(['starter', 'growth', 'pro']),
  email: z.string().email().optional(),
  ref: z.string().max(12).optional(),
});

/**
 * Public billing endpoint. The marketing site's plan buttons POST here and get
 * back a URL to redirect the browser to (Stripe Checkout when live, a safe
 * placeholder offline).
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  async checkout(
    @Body() body: unknown,
  ): Promise<{ url: string; offline: boolean }> {
    const { plan, email, ref } = CheckoutBody.parse(body);
    return this.billing.createCheckout({ plan: plan as PlanId, email, ref });
  }

  /** The texted "update your card" link lands here (via /billing/manage). */
  @Post('portal')
  @HttpCode(200)
  async portal(@Body() body: unknown): Promise<{ url: string | null }> {
    const parsed = PortalBody.safeParse(body);
    if (!parsed.success) return { url: null };
    const session = await this.billing.createPortalSession(parsed.data.t);
    return { url: session?.url ?? null };
  }
}
