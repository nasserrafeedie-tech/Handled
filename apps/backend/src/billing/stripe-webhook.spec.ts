import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { StripeWebhookController, upgradeText } from './stripe-webhook.controller';

/**
 * Payment must land on the customer who already exists.
 *
 * Phone is the account key. A customer signed up in person already has a row —
 * with their brand profile, their connected Instagram, their conversation. When
 * they pay, the webhook has to resolve to THAT row. Matching on Stripe's raw
 * string instead splits them in two: the new row carries the plan they paid
 * for, the old row carries the Instagram account, and neither is a whole
 * customer. Nothing errors, and the symptom appears a week later as "why is my
 * paying customer getting no carousels".
 */

function makeController(rows: Record<string, any>, seen = new Set<string>()) {
  const calls = {
    onboarded: [] as string[],
    notified: [] as string[],
    paused: [] as string[],
    tasks: [] as any[],
    planned: [] as string[],
  } as any;
  const prisma = {
    customer: {
      upsert: async ({ where, create, update }: any) => {
        const existing = rows[where.phone];
        const row = existing
          ? { ...existing, ...update }
          : { id: `cus_${Object.keys(rows).length + 1}`, ...create };
        rows[where.phone] = row;
        return row;
      },
      findUnique: async ({ where }: any) =>
        (where.phone ? rows[where.phone] : Object.values(rows).find((r: any) => r.email && r.email === where.email)) ??
        null,
      findFirst: async ({ where }: any) =>
        Object.values(rows).find((r: any) => r.stripeCustomerId === where.stripeCustomerId) ?? null,
      update: async ({ where, data }: any) => {
        const row: any = Object.values(rows).find((r: any) => r.id === where.id);
        if (row) Object.assign(row, data);
        if (row && data.phone) rows[data.phone] = row;
        return row ?? {};
      },
    },
    brandProfile: {
      findUnique: async ({ where }: any) => {
        const row: any = Object.values(rows).find((r: any) => r.id === where.customerId);
        return row ? { onboardingComplete: Boolean(row.onboarded) } : null;
      },
    },
    connectedAccount: {
      findMany: async () => calls.connected ?? [],
      updateMany: async ({ where }: any) => {
        calls.revoked = (where.id?.in ?? []).length;
        return { count: calls.revoked };
      },
    },
    stripeWebhookEvent: {
      create: async ({ data }: any) => {
        if (seen.has(data.id)) {
          // Simulate the real unique-key violation Postgres/Prisma raises, so
          // claim() exercises its P2002 branch rather than a generic Error.
          throw new Prisma.PrismaClientKnownRequestError('duplicate key', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        seen.add(data.id);
        return data;
      },
      delete: async ({ where }: any) => {
        seen.delete(where.id);
        return { id: where.id };
      },
    },
  };
  const concierge = {
    beginOnboarding: async (id: string) => calls.onboarded.push(id),
    notify: async (id: string, msg: string) => calls.notified.push(msg),
    presentNextDraft: async () => false,
    planIfIdle: async (id: string) => {
      calls.planned.push(id);
      return true;
    },
  };
  const bus = {
    emit: async (t: any) => {
      calls.paused.push(t.customer_id);
      calls.tasks.push(t);
      // Act like the real pause handler so state-dependent paths can be seen.
      const row: any = Object.values(rows).find((r: any) => r.id === t.customer_id);
      if (row && t.type === 'PAUSE_CUSTOMER') {
        if (t.payload.resume) Object.assign(row, { status: 'active', pausedReason: null });
        else Object.assign(row, { status: 'paused', pausedReason: t.payload.reason });
      }
    },
  };
  const referrals = {
    record: async () => ({ isNew: false, creditId: null }),
    apply: async () => ({ status: 'pending' }),
  };
  const ctrl = new StripeWebhookController(
    prisma as any,
    bus as any,
    concierge as any,
    referrals as any,
  );
  return { ctrl, rows, calls };
}

/** Drive the private handler the way a real checkout event would. */
function checkout(ctrl: any, phone: string | undefined, plan = 'growth') {
  return ctrl.onCheckoutCompleted({
    type: 'checkout.session.completed',
    data: {
      object: {
        customer: 'cus_stripe_123',
        metadata: { plan },
        customer_details: { phone },
      },
    },
  });
}

describe('Stripe checkout → customer', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('upgrades the EXISTING hand-made customer rather than splitting them', async () => {
    // The row a founder-run signup created, already holding real state.
    const rows: Record<string, any> = {
      '+14244098341': {
        id: 'cus_original',
        phone: '+14244098341',
        planTier: 'starter',
        businessName: 'Torrance Dental',
      },
    };
    const { ctrl } = makeController(rows);

    // Stripe hands the number back in its own formatting.
    await checkout(ctrl, '(424) 409-8341');

    assert.equal(
      Object.keys(rows).length,
      1,
      'must not create a second customer record',
    );
    assert.equal(rows['+14244098341'].id, 'cus_original');
    assert.equal(rows['+14244098341'].planTier, 'growth', 'the plan they paid for');
    assert.equal(
      rows['+14244098341'].businessName,
      'Torrance Dental',
      'existing profile must survive',
    );
  });

  it('normalizes a fresh self-serve signup too', async () => {
    const { ctrl, rows, calls } = makeController({});
    await checkout(ctrl, '424-409-8341');
    assert.deepEqual(Object.keys(rows), ['+14244098341']);
    assert.equal(calls.onboarded.length, 1, 'first text should go out');
  });

  it('refuses a phone it could never text, instead of storing junk', async () => {
    const { ctrl, rows, calls } = makeController({});
    await checkout(ctrl, 'not-a-number');
    assert.equal(
      Object.keys(rows).length,
      0,
      'a customer we cannot reach is worse than none',
    );
    assert.equal(calls.onboarded.length, 0);
  });

  it('does nothing when Stripe sends no phone at all', async () => {
    const { ctrl, rows } = makeController({});
    await checkout(ctrl, undefined);
    assert.equal(Object.keys(rows).length, 0);
  });
});

describe('Stripe webhook signature', () => {
  const saved = { ...process.env };
  let ctrl: any;

  beforeEach(() => {
    ctrl = makeController({}).ctrl;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('fails CLOSED in production when no secret is configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal(ctrl.verify(Buffer.from('{}'), 't=1,v1=abc'), false);
  });

  it('rejects a forged signature', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const t = Math.floor(Date.now() / 1000);
    assert.equal(ctrl.verify(Buffer.from('{}'), `t=${t},v1=deadbeef`), false);
  });
});

/**
 * Plan changes made in Stripe's billing portal never touch our checkout flow,
 * so before this they were invisible: the customer paid more and silently kept
 * the old tier's features.
 */
describe('Stripe subscription updated → plan tier', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const updated = (ctrl: any, priceId: string | undefined) =>
    ctrl.onSubscriptionUpdated({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_stripe_123', items: { data: [{ price: { id: priceId } }] } } },
    });

  function starterCustomer() {
    return {
      '+14244098341': {
        id: 'cus_original',
        phone: '+14244098341',
        planTier: 'starter',
        stripeCustomerId: 'cus_stripe_123',
      },
    };
  }

  it('moves the customer onto the tier they now pay for', async () => {
    const rows = starterCustomer();
    const { ctrl } = makeController(rows);
    await updated(ctrl, 'price_growth');
    assert.equal(rows['+14244098341'].planTier, 'growth');
  });

  it('tells them carousels are on, because that is what they bought', async () => {
    const { ctrl, calls } = makeController(starterCustomer());
    await updated(ctrl, 'price_growth');
    assert.match(calls.notified.join(' '), /carousel/i);
  });

  it('Growth → Pro names reels and daily posts, not the carousels they already had', async () => {
    const rows = starterCustomer();
    rows['+14244098341'].planTier = 'growth';
    const { ctrl, calls } = makeController(rows);
    await updated(ctrl, 'price_pro');
    const text = calls.notified.join(' ');
    assert.match(text, /reels/);
    assert.match(text, /every day/);
    assert.doesNotMatch(text, /carousel/i);
  });

  it('Starter → Pro names everything the jump adds', () => {
    const text = upgradeText('starter', 'pro');
    assert.match(text, /carousels/);
    assert.match(text, /reels/);
    assert.match(text, /every day/);
    assert.match(text, /3 more accounts/);
  });

  it('a Pro upgrade says where to send clips, with the real upload link', () => {
    const text = upgradeText('growth', 'pro', 'cust-123');
    assert.match(text, /\/upload\?c=cust-123$/);
    assert.doesNotMatch(text, /your upload link/, 'never point at a link they were not given');
    assert.doesNotMatch(upgradeText('starter', 'growth', 'cust-123'), /upload/);
  });

  it('Starter → Growth gives the real cadence change', () => {
    assert.match(upgradeText('starter', 'growth'), /5 posts a week instead of 3/);
    assert.match(upgradeText('starter', 'growth'), /one more account/);
  });

  it('stays quiet on a downgrade', async () => {
    const rows = starterCustomer();
    rows['+14244098341'].planTier = 'pro';
    const { ctrl, calls } = makeController(rows);
    await updated(ctrl, 'price_growth');
    assert.equal(rows['+14244098341'].planTier, 'growth');
    assert.equal(calls.notified.length, 0, 'do not congratulate someone on losing features');
  });

  it('revokes social platforms over the new cap on a downgrade, keeping GBP', async () => {
    const rows = starterCustomer();
    rows['+14244098341'].planTier = 'pro';
    const { ctrl, calls } = makeController(rows);
    // Pro had GBP + 4 socials. Starter keeps GBP (always) + 1 social, so the
    // other 3 socials are revoked.
    calls.connected = [
      { id: 'gbp', platform: 'google_business' },
      { id: 'ig', platform: 'instagram' },
      { id: 'fb', platform: 'facebook' },
      { id: 'tk', platform: 'tiktok' },
      { id: 'th', platform: 'threads' },
    ];
    await updated(ctrl, 'price_starter');
    assert.equal(rows['+14244098341'].planTier, 'starter');
    assert.equal(calls.revoked, 3, 'the 3 socials over the Starter cap are revoked; GBP kept');
  });

  it('leaves the tier alone rather than guessing at an unknown price', async () => {
    const rows = starterCustomer();
    const { ctrl } = makeController(rows);
    await updated(ctrl, 'price_something_else');
    assert.equal(rows['+14244098341'].planTier, 'starter');
  });
});

/**
 * A declined card used to mean Handled kept publishing forever for someone who
 * had stopped paying. The distinction that matters is whether Stripe will try
 * again — cutting service over a card that expired last night loses a customer
 * who was never leaving.
 */
describe('Stripe payment failed', () => {
  const failed = (ctrl: any, nextAttempt: number | null) =>
    ctrl.onPaymentFailed({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_stripe_123', next_payment_attempt: nextAttempt } },
    });

  const paying = () => ({
    '+14244098341': {
      id: 'cus_original',
      phone: '+14244098341',
      planTier: 'growth',
      stripeCustomerId: 'cus_stripe_123',
    },
  });

  it('keeps posting while Stripe still intends to retry', async () => {
    const { ctrl, calls } = makeController(paying());
    await failed(ctrl, 1789000000);
    assert.equal(calls.paused.length, 0, 'must not cut service on a recoverable decline');
    assert.match(calls.notified.join(' '), /declined/i);
  });

  it('pauses once Stripe has given up', async () => {
    const { ctrl, calls } = makeController(paying());
    await failed(ctrl, null);
    assert.deepEqual(calls.paused, ['cus_original']);
    assert.match(calls.notified.join(' '), /paused/i);
  });
});

/** Stripe redelivers on any timeout. Handling twice must not act twice. */
describe('Stripe webhook idempotency', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('processes an event once and skips the redelivery', async () => {
    const seen = new Set<string>();
    const { ctrl } = makeController({}, seen);
    const evt = { id: 'evt_1', type: 'checkout.session.completed' };
    assert.equal(await (ctrl as any).claim(evt), true, 'first delivery is ours');
    assert.equal(await (ctrl as any).claim(evt), false, 'redelivery must be skipped');
  });

  it('still processes an event with no id rather than dropping it', async () => {
    const { ctrl } = makeController({});
    assert.equal(await (ctrl as any).claim({ type: 'x' }), true);
  });

  it('rethrows a TRANSIENT create error instead of dropping the event', async () => {
    // A connection blip is not a duplicate. Treating it as one would silently
    // drop a brand-new event; it must propagate so Stripe retries.
    const prisma = {
      stripeWebhookEvent: {
        create: async () => {
          throw new Error('connection reset'); // not a P2002
        },
      },
    };
    const ctrl = new StripeWebhookController(prisma as any, {} as any, {} as any);
    await assert.rejects(() =>
      (ctrl as any).claim({ id: 'evt_x', type: 'checkout.session.completed' }),
    );
  });

  it('releases the claim when the handler throws, so the retry re-runs', async () => {
    // The core fix: if a handler fails after claiming, the event must NOT stay
    // marked as seen, or Stripe's retry is skipped and the side effect is lost.
    const seen = new Set<string>();
    const prisma = {
      stripeWebhookEvent: {
        create: async ({ data }: any) => {
          if (seen.has(data.id)) {
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          seen.add(data.id);
          return data;
        },
        delete: async ({ where }: any) => {
          seen.delete(where.id);
          return { id: where.id };
        },
      },
      customer: { findFirst: async () => null },
    };
    // A concierge whose beginOnboarding throws simulates a downstream failure.
    const concierge = {
      beginOnboarding: async () => {
        throw new Error('SMS provider down');
      },
      notify: async () => {},
    };
    const ctrl = new StripeWebhookController(
      prisma as any,
      { emit: async () => {} } as any,
      concierge as any,
    );
    const event = {
      id: 'evt_retry',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_1',
          metadata: { plan: 'growth' },
          customer_details: { phone: '+14244098341' },
        },
      },
    };
    // First delivery: the handler throws, and handle() rethrows (→ Stripe 500).
    await assert.rejects(() =>
      (ctrl as any).handle({ rawBody: Buffer.from(JSON.stringify(event)) }, undefined),
    );
    // The claim must have been released — otherwise the id is still in `seen`.
    assert.equal(seen.has('evt_retry'), false, 'claim must be released on failure');
  });
});

describe('Stripe checkout → referral credit', () => {
  /**
   * A checkout through someone's ?ref= link puts a free month on the
   * referrer's Stripe balance and thanks them — once. A referred customer who
   * cancels and checks out again must not pay the referrer (or text them) a
   * second time.
   */
  function setup(referrer: any) {
    const rows: Record<string, any> = {};
    const { ctrl, calls } = makeController(rows);
    const credited = new Set<string>();
    const log = { recorded: 0, applied: [] as string[] };
    (ctrl as any).prisma.customer.findUnique = async ({ where }: any) =>
      where.referralCode === referrer.referralCode ? referrer : null;
    (ctrl as any).referrals = {
      record: async (_ref: any, referredId: string) => {
        log.recorded += 1;
        if (credited.has(referredId)) return { isNew: false, creditId: null };
        credited.add(referredId);
        return { isNew: true, creditId: `rc_${referredId}` };
      },
      apply: async (id: string) => {
        log.applied.push(id);
        return { status: 'applied' };
      },
    };
    const pay = (phone: string) =>
      (ctrl as any).onCheckoutCompleted({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: `cus_${phone}`,
            metadata: { plan: 'growth', ref: referrer.referralCode },
            customer_details: { phone },
          },
        },
      });
    return { ctrl, calls, log, rows, pay };
  }

  it('credits the referrer and thanks them, once per referred customer', async () => {
    const { calls, log, rows, pay } = setup({ id: 'referrer', referralCode: 'ABC123', planTier: 'pro' });

    await pay('424-409-8341');
    assert.equal(log.applied.length, 1);
    assert.equal(calls.notified.filter((m) => /referral just joined/.test(m)).length, 1);
    assert.equal(rows['+14244098341'].referredByCode, 'ABC123');

    // They cancel and come back through the same link.
    await pay('424-409-8341');
    assert.equal(log.recorded, 2);
    assert.equal(log.applied.length, 1, 'no second credit');
    assert.equal(
      calls.notified.filter((m) => /referral just joined/.test(m)).length,
      1,
      'no second thank-you',
    );
  });

  it('a second, different referral earns a second credit', async () => {
    const { log, pay } = setup({ id: 'referrer', referralCode: 'ABC123', planTier: 'pro' });
    await pay('424-409-8341');
    await pay('310-555-0101');
    assert.equal(log.applied.length, 2);
  });

  it('an unknown code credits nobody but still onboards the payer', async () => {
    const { calls, log, ctrl } = setup({ id: 'referrer', referralCode: 'ABC123', planTier: 'pro' });
    await (ctrl as any).onCheckoutCompleted({
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_x', metadata: { plan: 'growth', ref: 'NOPE' }, customer_details: { phone: '424-409-8341' } } },
    });
    assert.equal(log.recorded, 0);
    assert.equal(calls.onboarded.length, 1);
  });
});

describe('Getting back on after a billing pause', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const paid = (ctrl: any) =>
    ctrl.onInvoicePaid({ type: 'invoice.paid', data: { object: { customer: 'cus_stripe_123' } } });

  it('the declined-card texts carry a link to fix the card', async () => {
    const rows: Record<string, any> = {
      '+15550001111': { id: 'c1', phone: '+15550001111', stripeCustomerId: 'cus_stripe_123', status: 'active' },
    };
    const { ctrl, calls } = makeController(rows);
    for (const next of [1700000000, null]) {
      await ctrl['onPaymentFailed']({
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_stripe_123', next_payment_attempt: next } },
      });
    }
    assert.equal(calls.notified.length, 2);
    for (const msg of calls.notified) assert.match(msg, /\/billing\/manage\?t=/);
  });

  it('a paid invoice lifts a billing pause and says so', async () => {
    const rows: Record<string, any> = {
      '+15550001111': {
        id: 'c1', phone: '+15550001111', stripeCustomerId: 'cus_stripe_123',
        status: 'paused', pausedReason: 'billing',
      },
    };
    const { ctrl, calls } = makeController(rows);
    await paid(ctrl);
    assert.equal(calls.tasks[0].payload.resume, true);
    assert.equal(rows['+15550001111'].status, 'active');
    assert.match(calls.notified[0], /back on/);
  });

  it('a routine renewal, or an owner who texted STOP, is left alone', async () => {
    for (const r of [
      { status: 'active', pausedReason: null },
      { status: 'paused', pausedReason: 'owner_stop' },
    ]) {
      const rows: Record<string, any> = {
        '+15550001111': { id: 'c1', phone: '+15550001111', stripeCustomerId: 'cus_stripe_123', ...r },
      };
      const { ctrl, calls } = makeController(rows);
      await paid(ctrl);
      assert.equal(calls.tasks.length, 0);
      assert.equal(calls.notified.length, 0);
    }
  });

  it('re-subscribing after a cancel un-pauses them and welcomes them back (not silence)', async () => {
    const rows: Record<string, any> = {
      '+14244098341': {
        id: 'c1', phone: '+14244098341', stripeCustomerId: 'cus_old',
        status: 'paused', pausedReason: 'billing', onboarded: true,
      },
    };
    const { ctrl, calls } = makeController(rows);
    await checkout(ctrl, '+14244098341');
    assert.equal(rows['+14244098341'].status, 'active');
    assert.match(calls.notified.at(-1), /Welcome back/);
    assert.deepEqual(calls.onboarded, [], 'no re-interview for a finished profile');
    // "I'll plan your next posts" is kept now, not at next Monday's run.
    assert.deepEqual(calls.planned, ['c1']);
  });
});

describe('Stripe subscription ended', () => {
  const ended = (ctrl: any) =>
    ctrl.onSubscriptionDeleted({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_stripe_123' } },
    });

  it('pauses as "ended", not as a failed payment, and says how to restart', async () => {
    const rows: Record<string, any> = {
      '+15550001111': { id: 'c1', phone: '+15550001111', stripeCustomerId: 'cus_stripe_123', status: 'active' },
    };
    const { ctrl, calls } = makeController(rows);
    await ended(ctrl);
    assert.equal(rows['+15550001111'].pausedReason, 'subscription_ended');
    assert.match(calls.notified[0], /\/billing\b/);
    assert.doesNotMatch(calls.notified[0], /card|payment/i);
  });

  it('a later invoice.paid alone does not lift it (only a new checkout does)', async () => {
    const rows: Record<string, any> = {
      '+15550001111': {
        id: 'c1', phone: '+15550001111', stripeCustomerId: 'cus_stripe_123',
        status: 'paused', pausedReason: 'subscription_ended',
      },
    };
    const { ctrl, calls } = makeController(rows);
    await ctrl.onInvoicePaid({ type: 'invoice.paid', data: { object: { customer: 'cus_stripe_123' } } });
    assert.equal(calls.tasks.length, 0);
  });

  it('re-subscribing after it ends brings them back', async () => {
    const rows: Record<string, any> = {
      '+14244098341': {
        id: 'c1', phone: '+14244098341', stripeCustomerId: 'cus_old',
        status: 'paused', pausedReason: 'subscription_ended', onboarded: true,
      },
    };
    const { ctrl, calls } = makeController(rows);
    await checkout(ctrl, '+14244098341');
    assert.equal(rows['+14244098341'].status, 'active');
    assert.match(calls.notified.at(-1), /Welcome back/);
  });
});

describe('Stripe checkout after an email signup', () => {
  it('attaches the phone to the email customer instead of making a second one', async () => {
    const rows: Record<string, any> = {
      'email:juniper': { id: 'cus_email', phone: null, email: 'jo@juniper.test', businessName: 'Juniper Florals', planTier: 'starter' },
    };
    const { ctrl, calls } = makeController(rows);
    await ctrl['onCheckoutCompleted']({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_stripe_9',
          metadata: { plan: 'growth' },
          customer_details: { phone: '+13105550303', email: 'Jo@Juniper.test' },
        },
      },
    });
    const ids = new Set(Object.values(rows).map((r: any) => r.id));
    assert.deepEqual([...ids], ['cus_email']);
    assert.equal(rows['+13105550303'].planTier, 'growth');
    assert.deepEqual(calls.onboarded, ['cus_email']);
  });

  it('leaves an email row that already has another phone alone', async () => {
    const rows: Record<string, any> = {
      '+13105550000': { id: 'cus_email', phone: '+13105550000', email: 'jo@juniper.test' },
    };
    const { ctrl, calls } = makeController(rows);
    await ctrl['onCheckoutCompleted']({
      type: 'checkout.session.completed',
      data: { object: { customer: 'c', metadata: { plan: 'starter' }, customer_details: { phone: '+13105550303', email: 'jo@juniper.test' } } },
    });
    assert.equal(rows['+13105550000'].phone, '+13105550000');
    assert.notEqual(calls.onboarded[0], 'cus_email');
  });
});
