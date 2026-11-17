import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { HOUSE_PROFILE, HOUSE_STRIPE_ID, NOT_HOUSE, setUpHouseAccount } from './house-account';
import { assignOwnerRequests } from '../operator/handlers/plan-week.handler';

type Row = Record<string, any>;

function db(rows: Row[] = []) {
  const profiles: Row[] = [];
  const prisma = {
    customer: {
      findUnique: async ({ where }: Row) => rows.find((r) => r.phone === where.phone) ?? null,
      findFirst: async ({ where }: Row) => rows.find((r) => r.stripeCustomerId === where.stripeCustomerId) ?? null,
      update: async ({ where, data }: Row) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      create: async ({ data }: Row) => {
        const { conversation, brandProfile, ...rest } = data;
        const row = { id: `c${rows.length + 1}`, ...rest };
        rows.push(row);
        return row;
      },
    },
    brandProfile: { upsert: async ({ create, update }: Row) => void profiles.push({ create, update }) },
    conversation: { upsert: async () => ({}) },
  };
  return { prisma: prisma as never, rows, profiles };
}

describe("Handled's own account", () => {
  it('is a paid, live Pro account with its profile filled in, so there is no interview', async () => {
    const w = db();
    const out = await setUpHouseAccount(w.prisma, '(626) 555-0100');
    assert.ok(!('error' in out));
    assert.equal(out.phone, '+16265550100');
    const row = w.rows[0];
    assert.equal(row.stripeCustomerId, HOUSE_STRIPE_ID);
    assert.equal(row.status, 'active');
    assert.equal(row.planTier, 'pro');
    assert.equal(row.trustLevel, 'approve_all', 'every post still waits on a yes');
    assert.equal(w.profiles[0].create.onboardingComplete, true);
  });

  it('starts with posts that sell by showing, one per planned slot', () => {
    const slots = [{}, {}, {}] as Array<{ owner_request?: string }>;
    const r = assignOwnerRequests(slots, HOUSE_PROFILE.postRequests);
    assert.match(r.slots[0].owner_request!, /three texts/);
    assert.equal(r.left.length, HOUSE_PROFILE.postRequests.length - 3);
  });

  it('never makes up results or testimonials', () => {
    assert.ok(HOUSE_PROFILE.dosAndDonts.some((d) => /testimonials/.test(d)));
  });

  it("won't take over a paying customer's number", async () => {
    const w = db([{ id: 'x', phone: '+16265550100', stripeCustomerId: 'cus_real', businessName: 'Rosa' }]);
    const out = await setUpHouseAccount(w.prisma, '+16265550100');
    assert.equal('error' in out && out.error, 'phone_in_use');
    assert.equal(w.rows[0].stripeCustomerId, 'cus_real');
  });

  it('moves to a new number rather than making a second one', async () => {
    const w = db([{ id: 'h', phone: '+16265550100', stripeCustomerId: HOUSE_STRIPE_ID }]);
    const out = await setUpHouseAccount(w.prisma, '+16265550199');
    assert.ok(!('error' in out) && !out.created);
    assert.equal(w.rows.length, 1);
    assert.equal(w.rows[0].phone, '+16265550199');
  });

  it('stays out of revenue and customer counts', () => {
    assert.deepEqual(NOT_HOUSE.OR[1], { stripeCustomerId: { not: HOUSE_STRIPE_ID } });
    assert.deepEqual(NOT_HOUSE.OR[0], { stripeCustomerId: null }, 'unpaid leads still count');
  });
});
