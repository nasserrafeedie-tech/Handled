import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPortalToken } from './portal-link';

export type PlanId = 'starter' | 'growth' | 'pro';

export interface CheckoutRequest {
  plan: PlanId;
  /** Optional customer email to prefill Stripe Checkout. */
  email?: string;
  /** Referral code from a ?ref= link. */
  ref?: string;
}

export interface CheckoutResult {
  url: string;
  /** True when running without a Stripe key (returns a safe placeholder). */
  offline: boolean;
}

/**
 * Stripe billing (§ payments). Creates a hosted Checkout Session for the chosen
 * subscription plan and hands back the URL for the browser to redirect to. We
 * talk to Stripe over plain fetch (form-encoded) so there's no SDK dependency —
 * the whole thing flips on the moment STRIPE_SECRET_KEY + price IDs are set.
 *
 * Offline mode: with no STRIPE_SECRET_KEY we return a harmless placeholder so
 * the site and flow can be demoed end-to-end for free.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Turn a texted "update your card" link into a Stripe customer-portal
   * session. Returns null for a bad/expired link or a customer Stripe doesn't
   * know — the page then says "text us" instead of a dead end.
   */
  async createPortalSession(token: string | undefined): Promise<{ url: string } | null> {
    const customerId = verifyPortalToken(token);
    if (!customerId) return null;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { stripeCustomerId: true },
    });
    if (!customer?.stripeCustomerId) return null;

    const secret = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
    if (!secret) {
      this.log.warn('Stripe offline mode — portal link resolves to the demo page');
      return { url: `${siteUrl}/billing?demo=1&portal=1` };
    }
    const form = new URLSearchParams();
    form.set('customer', customer.stripeCustomerId);
    form.set('return_url', `${siteUrl}/billing?status=updated`);
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      // Most likely: the customer portal hasn't been switched on in the Stripe
      // dashboard yet (Settings → Billing → Customer portal).
      this.log.error(`Stripe portal session failed → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return data.url ? { url: data.url } : null;
  }

  /** Map each plan to its Stripe Price ID (set in env when you go live). */
  private priceId(plan: PlanId): string | undefined {
    return {
      starter: process.env.STRIPE_PRICE_STARTER,
      growth: process.env.STRIPE_PRICE_GROWTH,
      pro: process.env.STRIPE_PRICE_PRO,
    }[plan];
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const secret = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';

    if (!secret) {
      this.log.warn(
        'Stripe offline mode (no STRIPE_SECRET_KEY) — returning placeholder URL',
      );
      return { url: `${siteUrl}/billing?demo=1&plan=${req.plan}`, offline: true };
    }

    const price = this.priceId(req.plan);
    if (!price) {
      throw new Error(`No Stripe price configured for plan "${req.plan}"`);
    }

    // Stripe expects application/x-www-form-urlencoded with bracket notation.
    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('line_items[0][price]', price);
    form.set('line_items[0][quantity]', '1');
    form.set('success_url', `${siteUrl}/billing?status=success`);
    form.set('cancel_url', `${siteUrl}/billing?status=cancelled`);
    form.set('allow_promotion_codes', 'true');
    // Managed Payments is on by default on new Stripe accounts. It makes Stripe
    // the merchant of record and handles sales tax — but it refuses to create a
    // session until every product carries a tax code, which ours do not.
    //
    // Turned off here rather than tagging the products, so that sales tax stays
    // our responsibility. That is the right trade only while the tax picture is
    // simple: advertising and marketing services are untaxed in most US states,
    // and we sell to one state today. Revisit when we sell across state lines or
    // revenue is large enough that getting this wrong costs more than the
    // half hour it takes to set product tax codes and delete this line.
    form.set('managed_payments[enabled]', 'false');
    // With Managed Payments off, Stripe no longer picks payment methods for us,
    // and a new account has none explicitly activated — so it refuses the
    // session for having nothing to charge. Naming `card` outright is what we
    // want regardless: a monthly subscription needs a card on file it can
    // re-charge, and leaving the choice to account defaults means a dashboard
    // toggle somewhere can silently change how customers pay us.
    form.set('payment_method_types[0]', 'card');
    // The phone number IS the account (§2) — without it the webhook can't
    // start the SMS relationship. The plan rides along as metadata.
    form.set('phone_number_collection[enabled]', 'true');
    form.set('metadata[plan]', req.plan);
    if (req.ref) form.set('metadata[ref]', req.ref.toUpperCase());
    if (req.email) form.set('customer_email', req.email);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Stripe checkout failed → ${res.status} ${res.statusText}` +
          (detail ? `: ${detail.slice(0, 300)}` : ''),
      );
    }

    const data = (await res.json()) as { url?: string };
    if (!data.url) throw new Error('Stripe returned no checkout URL');
    return { url: data.url, offline: false };
  }
}
