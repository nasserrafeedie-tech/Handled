import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { BusinessMetricsService } from './business-metrics.service';

const DAY = 86_400_000;
const NOW = new Date('2026-07-21T12:00:00Z');

interface C {
  id: string;
  businessName: string | null;
  status: string;
  planTier: string;
  createdAt: Date;
  updatedAt: Date;
}

interface U {
  customerId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const cust = (over: Partial<C> = {}): C => ({
  id: `c${Math.random()}`,
  businessName: 'Test Co',
  status: 'active',
  planTier: 'growth',
  createdAt: new Date(NOW.getTime() - 200 * DAY),
  updatedAt: new Date(NOW.getTime() - 200 * DAY),
  ...over,
});

const use = (over: Partial<U> = {}): U => ({
  customerId: 'c1',
  model: 'claude-haiku-4-5',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

const build = (customers: C[], usage: U[] = []) =>
  new BusinessMetricsService({
    customer: { findMany: async () => customers },
    llmUsage: { findMany: async () => usage },
  } as any);

describe('customer counts', () => {
  it('counts each status separately', async () => {
    const m = await build([
      cust({ status: 'active' }),
      cust({ status: 'active' }),
      cust({ status: 'paused' }),
      cust({ status: 'cancelled' }),
      cust({ status: 'onboarding' }),
    ]).build(NOW);
    assert.deepEqual(m.customers, { active: 2, paused: 1, cancelled: 1, onboarding: 1 });
  });
});

describe('churn', () => {
  const many = (n: number, over: Partial<C> = {}) => Array.from({ length: n }, () => cust(over));

  it('divides by everyone who could have left, not just those who stayed', async () => {
    // 5 lost from a base of 95 active is ~5%, not 5/95 of the survivors only.
    const m = await build([
      ...many(95),
      ...many(5, { status: 'cancelled', updatedAt: new Date(NOW.getTime() - 3 * DAY) }),
    ]).build(NOW);
    assert.equal(m.churn.lost30d, 5);
    assert.equal(m.churn.baseline, 100);
    assert.equal(m.churn.monthlyRatePct, 5);
  });

  it('ignores cancellations older than the window', async () => {
    const m = await build([
      ...many(20),
      cust({ status: 'cancelled', updatedAt: new Date(NOW.getTime() - 90 * DAY) }),
    ]).build(NOW);
    assert.equal(m.churn.lost30d, 0);
  });

  it('calls above 5% a fire', async () => {
    const m = await build([
      ...many(80),
      ...many(10, { status: 'cancelled', updatedAt: new Date(NOW.getTime() - DAY) }),
    ]).build(NOW);
    assert.equal(m.churn.verdict, 'fire');
  });

  it('flags the 3-5% band as worth watching', async () => {
    const m = await build([
      ...many(96),
      ...many(4, { status: 'cancelled', updatedAt: new Date(NOW.getTime() - DAY) }),
    ]).build(NOW);
    assert.equal(m.churn.verdict, 'watch');
  });

  it('calls a low rate healthy', async () => {
    const m = await build([
      ...many(99),
      cust({ status: 'cancelled', updatedAt: new Date(NOW.getTime() - DAY) }),
    ]).build(NOW);
    assert.equal(m.churn.verdict, 'healthy');
  });

  it('refuses to call one loss out of two a fire', async () => {
    // 50% churn on a base of two is noise. Crying fire here would teach you
    // to ignore the number by the time it is real.
    const m = await build([
      cust(),
      cust({ status: 'cancelled', updatedAt: new Date(NOW.getTime() - DAY) }),
    ]).build(NOW);
    assert.equal(m.churn.verdict, 'no data');
  });

  it('says no data when there are no customers at all', async () => {
    const m = await build([]).build(NOW);
    assert.equal(m.churn.monthlyRatePct, null);
    assert.equal(m.churn.verdict, 'no data');
  });
});

describe('revenue', () => {
  it('prices each tier and totals MRR', async () => {
    const m = await build([
      cust({ planTier: 'starter' }),
      cust({ planTier: 'growth' }),
      cust({ planTier: 'growth' }),
      cust({ planTier: 'pro' }),
    ]).build(NOW);
    assert.equal(m.revenue.mrrUsd, 95 + 349 * 2 + 699);
  });

  it('counts only active customers toward MRR', async () => {
    // A cancelled customer is not revenue.
    const m = await build([
      cust({ planTier: 'growth' }),
      cust({ planTier: 'growth', status: 'cancelled' }),
      cust({ planTier: 'growth', status: 'paused' }),
    ]).build(NOW);
    assert.equal(m.revenue.mrrUsd, 349);
  });

  it('is zero with no customers', async () => {
    assert.equal((await build([]).build(NOW)).revenue.mrrUsd, 0);
  });
});

describe('cost to serve', () => {
  it('attributes spend to the customer who caused it', async () => {
    const m = await build(
      [cust({ id: 'c1', businessName: "Rosa's" })],
      [use({ customerId: 'c1', outputTokens: 1_000_000 })],
    ).build(NOW);
    assert.equal(m.cost.perCustomer[0].customerId, 'c1');
    assert.equal(m.cost.perCustomer[0].businessName, "Rosa's");
    assert.equal(m.cost.perCustomer[0].usd, 5);
  });

  it('counts shared work in the total but charges it to nobody', async () => {
    // Playbook research is paid once and reused by the whole trade.
    const m = await build(
      [cust({ id: 'c1' })],
      [use({ customerId: null, outputTokens: 1_000_000 })],
    ).build(NOW);
    assert.equal(m.cost.last30dUsd, 5);
    assert.equal(m.cost.perCustomer.length, 0);
  });

  it('puts the most expensive customer first', async () => {
    const m = await build(
      [cust({ id: 'c1' }), cust({ id: 'c2' })],
      [
        use({ customerId: 'c1', outputTokens: 100_000 }),
        use({ customerId: 'c2', outputTokens: 900_000 }),
      ],
    ).build(NOW);
    assert.equal(m.cost.perCustomer[0].customerId, 'c2');
  });

  it('reports cost as a share of MRR, which is the number that matters', async () => {
    const m = await build(
      [cust({ id: 'c1', planTier: 'starter' })], // $95
      [use({ customerId: 'c1', outputTokens: 1_000_000 })], // $5
    ).build(NOW);
    assert.ok(Math.abs((m.cost.pctOfMrr ?? 0) - (5 / 95) * 100) < 1e-9);
  });

  it('does not divide by zero when there is no revenue', async () => {
    const m = await build([], [use({ customerId: null, outputTokens: 1000 })]).build(NOW);
    assert.equal(m.cost.pctOfMrr, null);
  });

  it('shows a sub-cent cost as such rather than as free', async () => {
    const m = await build(
      [cust({ id: 'c1' })],
      [use({ customerId: 'c1', inputTokens: 500 })],
    ).build(NOW);
    assert.equal(m.cost.perCustomer[0].label, '<$0.01');
  });
});
