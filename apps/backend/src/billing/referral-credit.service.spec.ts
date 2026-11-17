import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  ReferralCreditService,
  MAX_ATTEMPTS,
  balanceTransactionForm,
  idempotencyKey,
} from './referral-credit.service';
import { monthlyCents } from './plan-prices';

/**
 * The referral credit pays out once, for the right amount, to the right
 * Stripe customer — and a failure never loses the credit.
 *
 * The texts already promise "a free month is coming off your next bill". If
 * this breaks one way the promise is quietly not kept; if it breaks the other
 * way the business gives away a month per Stripe retry.
 */

type Row = Record<string, any>;

function makePrisma(customers: Row[]) {
  const credits: Row[] = [];
  let n = 0;
  const prisma = {
    credits,
    customer: {
      findUnique: async ({ where }: any) => customers.find((c) => c.id === where.id) ?? null,
    },
    referralCredit: {
      create: async ({ data }: any) => {
        if (credits.some((c) => c.referredCustomerId === data.referredCustomerId)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate key', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row = { id: `rc_${++n}`, attempts: 0, lastError: null, createdAt: new Date(), ...data };
        credits.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => credits.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: any) => credits.filter((c) => c.status === where.status),
      update: async ({ where, data }: any) => {
        const row = credits.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
  return prisma;
}

type FetchCall = { url: string; init: any };

function stubFetch(responder: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  };
  return calls;
}

const ok = (id = 'cbtxn_123') =>
  new Response(JSON.stringify({ id }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('ReferralCreditService', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = realKey;
  });

  it('credits one month of the referrer’s plan as a negative Stripe balance', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);
    const calls = stubFetch(() => ok('cbtxn_9'));

    const rec = await svc.record({ id: 'ref', planTier: 'growth' }, 'new', 'ABC123');
    assert.equal(rec.isNew, true);
    const out = await svc.apply(rec.creditId!);

    assert.equal(out.status, 'applied');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/customers/cus_REF/balance_transactions');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('amount'), '-34900');
    assert.equal(body.get('currency'), 'usd');
    assert.equal(calls[0].init.headers['idempotency-key'], idempotencyKey(rec.creditId!));
    assert.equal(prisma.credits[0].stripeBalanceTxnId, 'cbtxn_9');
    assert.ok(prisma.credits[0].appliedAt instanceof Date);
  });

  it('a referred customer who checks out again earns no second credit', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);

    const first = await svc.record({ id: 'ref', planTier: 'pro' }, 'new', 'ABC123');
    const again = await svc.record({ id: 'ref', planTier: 'pro' }, 'new', 'ABC123');

    assert.equal(first.isNew, true);
    assert.equal(again.isNew, false);
    assert.equal(again.creditId, null);
    assert.equal(prisma.credits.length, 1);
  });

  it('never credits someone for referring themselves', async () => {
    const prisma = makePrisma([]);
    const svc = new ReferralCreditService(prisma as any);
    const rec = await svc.record({ id: 'same', planTier: 'pro' }, 'same', 'ABC123');
    assert.equal(rec.isNew, false);
    assert.equal(prisma.credits.length, 0);
  });

  it('an applied credit is never sent to Stripe again', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);
    const calls = stubFetch(() => ok());
    const rec = await svc.record({ id: 'ref', planTier: 'starter' }, 'new', 'X');
    await svc.apply(rec.creditId!);
    await svc.apply(rec.creditId!);
    await svc.retryPending();
    assert.equal(calls.length, 1);
  });

  it('waits, without spending an attempt, while Stripe is not set up', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);
    const calls = stubFetch(() => ok());
    const rec = await svc.record({ id: 'ref', planTier: 'growth' }, 'new', 'X');

    const out = await svc.apply(rec.creditId!);
    assert.equal(out.status, 'pending');
    assert.equal(prisma.credits[0].attempts, 0);
    assert.equal(calls.length, 0);
  });

  it('waits for a referrer who has no Stripe customer yet, then lands later', async () => {
    const referrer: Row = { id: 'ref', stripeCustomerId: null };
    const prisma = makePrisma([referrer]);
    const svc = new ReferralCreditService(prisma as any);
    const calls = stubFetch(() => ok());
    const rec = await svc.record({ id: 'ref', planTier: 'growth' }, 'new', 'X');

    assert.equal((await svc.apply(rec.creditId!)).status, 'pending');
    assert.equal(calls.length, 0);

    referrer.stripeCustomerId = 'cus_LATER';
    const tally = await svc.retryPending();
    assert.deepEqual(tally, { applied: 1, pending: 0, failed: 0 });
    assert.match(calls[0].url, /cus_LATER/);
  });

  it('a Stripe outage keeps the credit pending, then gives up into failed after MAX_ATTEMPTS', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);
    stubFetch(() => new Response('upstream sad', { status: 503 }));
    const rec = await svc.record({ id: 'ref', planTier: 'growth' }, 'new', 'X');

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      assert.equal((await svc.apply(rec.creditId!)).status, 'pending');
      assert.equal(prisma.credits[0].attempts, i);
    }
    const last = await svc.apply(rec.creditId!);
    assert.equal(last.status, 'failed');
    assert.match(prisma.credits[0].lastError, /503/);
  });

  it('a network error is retried, not lost', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);
    let first = true;
    const calls = stubFetch(() => {
      if (first) {
        first = false;
        throw new Error('socket hang up');
      }
      return ok();
    });
    const rec = await svc.record({ id: 'ref', planTier: 'growth' }, 'new', 'X');
    assert.equal((await svc.apply(rec.creditId!)).status, 'pending');
    assert.equal((await svc.apply(rec.creditId!)).status, 'applied');
    // Same key both times — if the first had actually reached Stripe, the
    // second would be answered from Stripe's idempotency cache, not re-applied.
    assert.equal(calls[0].init.headers['idempotency-key'], calls[1].init.headers['idempotency-key']);
  });

  it('a customer Stripe says is gone fails at once instead of retrying all week', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_GONE' }]);
    const svc = new ReferralCreditService(prisma as any);
    stubFetch(() => new Response('{"error":{"code":"resource_missing"}}', { status: 404 }));
    const rec = await svc.record({ id: 'ref', planTier: 'growth' }, 'new', 'X');
    assert.equal((await svc.apply(rec.creditId!)).status, 'failed');
    assert.equal(prisma.credits[0].attempts, 1);
  });

  it('freezes the amount at referral time: a later upgrade doesn’t change what’s owed', async () => {
    const prisma = makePrisma([{ id: 'ref', stripeCustomerId: 'cus_REF' }]);
    const svc = new ReferralCreditService(prisma as any);
    const rec = await svc.record({ id: 'ref', planTier: 'starter' }, 'new', 'X');
    assert.equal(prisma.credits.find((c) => c.id === rec.creditId)!.amountCents, 9500);
  });

  it('an unpriced tier still owes a month (at Starter), never zero', async () => {
    const prisma = makePrisma([]);
    const svc = new ReferralCreditService(prisma as any);
    await svc.record({ id: 'ref', planTier: 'legacy' }, 'new', 'X');
    assert.equal(prisma.credits[0].amountCents, 9500);
  });
});

describe('balanceTransactionForm', () => {
  it('always sends a credit (negative), whatever sign is stored', () => {
    const form = balanceTransactionForm({ id: 'rc_1', amountCents: -9500, code: 'X', referredCustomerId: 'c' });
    assert.equal(form.get('amount'), '-9500');
    assert.equal(form.get('metadata[referral_credit_id]'), 'rc_1');
  });
});

describe('monthlyCents', () => {
  it('prices the three live plans and nothing else', () => {
    assert.equal(monthlyCents('starter'), 9500);
    assert.equal(monthlyCents('GROWTH'), 34900);
    assert.equal(monthlyCents('pro'), 69900);
    assert.equal(monthlyCents('premium'), null);
    assert.equal(monthlyCents(null), null);
  });
});
