import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StripeWebhookController } from './stripe-webhook.controller';

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
  const calls = { onboarded: [] as string[], notified: [] as string[], paused: [] as string[] };
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
      findUnique: async () => null,
      findFirst: async ({ where }: any) =>
        Object.values(rows).find((r: any) => r.stripeCustomerId === where.stripeCustomerId) ?? null,
      update: async ({ where, data }: any) => {
        const row: any = Object.values(rows).find((r: any) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? {};
      },
    },
    stripeWebhookEvent: {
      create: async ({ data }: any) => {
        if (seen.has(data.id)) throw new Error('duplicate key');
        seen.add(data.id);
        return data;
      },
    },
  };
  const concierge = {
    beginOnboarding: async (id: string) => calls.onboarded.push(id),
    notify: async (id: string, msg: string) => calls.notified.push(msg),
  };
  const bus = { emit: async (t: any) => calls.paused.push(t.customer_id) };
  const ctrl = new StripeWebhookController(
    prisma as any,
    bus as any,
    concierge as any,
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

  it('stays quiet on a downgrade', async () => {
    const rows = starterCustomer();
    rows['+14244098341'].planTier = 'pro';
    const { ctrl, calls } = makeController(rows);
    await updated(ctrl, 'price_growth');
    assert.equal(rows['+14244098341'].planTier, 'growth');
    assert.equal(calls.notified.length, 0, 'do not congratulate someone on losing features');
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
});
