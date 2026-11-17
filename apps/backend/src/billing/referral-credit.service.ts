import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { monthlyCents } from './plan-prices';

/**
 * The referral credit, automated.
 *
 * When a new customer pays through someone's referral link, the referrer is
 * texted "a free month is coming off your next bill". Until this existed that
 * promise was kept by hand in the Stripe dashboard — and a promise that
 * depends on someone remembering is one that eventually gets broken.
 *
 * The credit is a negative Stripe customer balance on the referrer, worth one
 * month of the plan they were on when the referral landed. Stripe draws a
 * customer balance down automatically on the next invoice, so "off your next
 * bill" is literally what happens.
 *
 * Paying out exactly once is the whole game, and it is held three ways:
 *   1. one ReferralCredit row per referred customer (unique key) — a referred
 *      customer who cancels and checks out again doesn't pay the referrer twice;
 *   2. an Idempotency-Key on the Stripe call derived from that row, so a retry
 *      after a timeout (did Stripe get it or not?) can never double-apply;
 *   3. status 'applied' is terminal — the sweep never looks at it again.
 *
 * It never throws into the Stripe webhook. A failure leaves the row pending
 * for the daily sweep, and after MAX_ATTEMPTS it turns 'failed' and shows in
 * the admin view for a human to settle — so goodwill never silently drops.
 */
export const MAX_ATTEMPTS = 6;

export type CreditStatus = 'pending' | 'applied' | 'failed';

export interface RecordOutcome {
  /** False when this referred customer already earned their referrer a credit. */
  isNew: boolean;
  creditId: string | null;
}

export interface ApplyOutcome {
  status: CreditStatus;
  /** Plain-English reason when not applied. */
  note?: string;
}

/** Stripe answers that won't change on retry: bad request, customer gone. */
const PERMANENT_HTTP = new Set([400, 402, 404]);

/** The form body for POST /v1/customers/{id}/balance_transactions. */
export function balanceTransactionForm(credit: {
  id: string;
  amountCents: number;
  code: string;
  referredCustomerId: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  // Negative = credit. Stripe applies it to the customer's next invoice.
  form.set('amount', String(-Math.abs(credit.amountCents)));
  form.set('currency', 'usd');
  form.set('description', `Referral credit: one free month (code ${credit.code})`);
  form.set('metadata[kind]', 'referral_credit');
  form.set('metadata[referral_credit_id]', credit.id);
  form.set('metadata[referred_customer_id]', credit.referredCustomerId);
  return form;
}

/** Stable per credit — the same credit can only ever reach Stripe once. */
export const idempotencyKey = (creditId: string): string => `referral-credit-${creditId}`;

@Injectable()
export class ReferralCreditService {
  private readonly log = new Logger(ReferralCreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Note that `referred` came in on `referrer`'s code. Idempotent: a second
   * call for the same referred customer is a no-op that reports isNew=false.
   */
  async record(
    referrer: { id: string; planTier: string | null },
    referredCustomerId: string,
    code: string,
  ): Promise<RecordOutcome> {
    if (referrer.id === referredCustomerId) return { isNew: false, creditId: null };

    // Unpriced tier (shouldn't happen): fall back to Starter rather than
    // owing nothing — the text already promised a free month.
    const amountCents = monthlyCents(referrer.planTier) ?? monthlyCents('starter')!;

    try {
      const row = await this.prisma.referralCredit.create({
        data: {
          referrerId: referrer.id,
          referredCustomerId,
          code,
          amountCents,
          status: 'pending',
        },
      });
      return { isNew: true, creditId: row.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { isNew: false, creditId: null };
      }
      throw e;
    }
  }

  /**
   * Try to put one pending credit on the referrer's Stripe balance. Never
   * throws; the outcome is written to the row either way.
   */
  async apply(creditId: string): Promise<ApplyOutcome> {
    const credit = await this.prisma.referralCredit.findUnique({ where: { id: creditId } });
    if (!credit) return { status: 'failed', note: 'Credit not found.' };
    if (credit.status !== 'pending') return { status: credit.status as CreditStatus };

    const secret = (process.env.STRIPE_SECRET_KEY ?? '').trim();
    if (!secret) {
      // Offline/dev: nothing to charge against. Don't burn an attempt — the
      // credit is simply waiting for Stripe to exist.
      return this.wait(credit.id, 'Stripe is not set up yet (no STRIPE_SECRET_KEY).');
    }

    const referrer = await this.prisma.customer.findUnique({
      where: { id: credit.referrerId },
      select: { stripeCustomerId: true },
    });
    if (!referrer) {
      return this.fail(credit.id, credit.attempts + 1, 'The referrer no longer exists.');
    }
    if (!referrer.stripeCustomerId) {
      // e.g. signed up in person and hasn't been through checkout. The credit
      // lands the day they have a Stripe customer; until then it waits.
      return this.wait(credit.id, 'The referrer has no Stripe customer yet.');
    }

    const attempts = credit.attempts + 1;
    let res: Response;
    try {
      res = await fetch(
        `https://api.stripe.com/v1/customers/${encodeURIComponent(referrer.stripeCustomerId)}/balance_transactions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'application/x-www-form-urlencoded',
            'idempotency-key': idempotencyKey(credit.id),
          },
          body: balanceTransactionForm(credit).toString(),
        },
      );
    } catch (e) {
      return this.retryOrFail(credit.id, attempts, `Couldn't reach Stripe: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      const why = `Stripe said ${res.status}${detail ? `: ${detail}` : ''}`;
      return PERMANENT_HTTP.has(res.status)
        ? this.fail(credit.id, attempts, why)
        : this.retryOrFail(credit.id, attempts, why);
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    await this.prisma.referralCredit.update({
      where: { id: credit.id },
      data: {
        status: 'applied',
        attempts,
        lastError: null,
        stripeBalanceTxnId: body.id ?? null,
        appliedAt: new Date(),
      },
    });
    this.log.log(`referral credit ${credit.id} applied (${credit.amountCents}¢)`);
    return { status: 'applied' };
  }

  /** The daily sweep: retry everything still pending. */
  async retryPending(): Promise<{ applied: number; pending: number; failed: number }> {
    const rows = await this.prisma.referralCredit.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true },
    });
    const tally = { applied: 0, pending: 0, failed: 0 };
    for (const r of rows) {
      const out = await this.apply(r.id);
      tally[out.status] += 1;
    }
    return tally;
  }

  /** Not an error, just not possible yet: keeps the row pending, no attempt spent. */
  private async wait(id: string, note: string): Promise<ApplyOutcome> {
    await this.prisma.referralCredit.update({ where: { id }, data: { lastError: note } });
    return { status: 'pending', note };
  }

  private async retryOrFail(id: string, attempts: number, note: string): Promise<ApplyOutcome> {
    if (attempts >= MAX_ATTEMPTS) return this.fail(id, attempts, note);
    this.log.warn(`referral credit ${id} attempt ${attempts} failed: ${note}`);
    await this.prisma.referralCredit.update({
      where: { id },
      data: { attempts, lastError: note },
    });
    return { status: 'pending', note };
  }

  private async fail(id: string, attempts: number, note: string): Promise<ApplyOutcome> {
    this.log.error(`referral credit ${id} gave up: ${note}`);
    await this.prisma.referralCredit.update({
      where: { id },
      data: { status: 'failed', attempts, lastError: note },
    });
    return { status: 'failed', note };
  }
}
