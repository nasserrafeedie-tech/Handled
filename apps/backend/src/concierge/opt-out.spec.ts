import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConciergeService } from './concierge.service';
import { PauseCustomerHandler } from '../operator/handlers/pause-customer.handler';
import { signPortalToken, verifyPortalToken, portalLink, PORTAL_LINK_TTL_MS } from '../billing/portal-link';
import { BillingService } from '../billing/billing.service';

/**
 * STOP has to be a real opt-out AND reversible.
 *
 * Before: STOP paused the account forever. The pause text said "until you say
 * go", but nothing anywhere could un-pause — START, go and resume all fell
 * through to "I'll keep that in mind". And while paused the owner still got
 * texts we started (a referral thank-you, for one), which after a STOP is the
 * one thing carriers forbid.
 */

type Row = Record<string, any>;

function handler(customer: Row, profile: Row | null) {
  const prisma = {
    brandProfile: { findUnique: async () => profile },
    customer: { update: async ({ data }: any) => Object.assign(customer, data) },
    post: { updateMany: async () => ({ count: 0 }) },
    queuedText: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const queue = { cancelAllForCustomer: async () => 0 };
  return new PauseCustomerHandler(prisma as any, queue as any);
}

const task = (payload: Row) =>
  ({ task_id: 't', customer_id: 'c1', type: 'PAUSE_CUSTOMER', payload }) as any;

describe('PAUSE_CUSTOMER keeps why, and resume puts them back where they were', () => {
  it('a pause records its reason', async () => {
    const c: Row = { status: 'active' };
    await handler(c, null).handle(task({ reason: 'billing', resume: false }));
    assert.deepEqual([c.status, c.pausedReason], ['paused', 'billing']);
  });

  it('the STOP confirmation tells them how to come back', async () => {
    const out = await handler({}, null).handle(task({ reason: 'owner_stop', resume: false }));
    assert.match(out.summary_for_owner, /START/);
  });

  it('resume returns a finished customer to active and clears the reason', async () => {
    const c: Row = { status: 'paused', pausedReason: 'owner_stop' };
    await handler(c, { onboardingComplete: true }).handle(task({ reason: 'owner_stop', resume: true }));
    assert.deepEqual([c.status, c.pausedReason], ['active', null]);
  });

  it('resume returns a half-onboarded customer to onboarding, not active', async () => {
    const c: Row = { status: 'paused', pausedReason: 'owner_stop' };
    await handler(c, { onboardingComplete: false }).handle(task({ reason: 'owner_stop', resume: true }));
    assert.equal(c.status, 'onboarding');
  });
});

describe('Opt-back-in words', () => {
  const svc = new ConciergeService(...(Array(12).fill(undefined) as [])) as unknown as {
    isResume(b: string): boolean;
  };
  it('match Twilio’s own opt-in keywords, which are the only ones that unblock texting', () => {
    for (const w of ['START', 'start', 'Unstop', 'yes', 'YES!']) assert.equal(svc.isResume(w), true, w);
  });
  it('do not fire on sentences', () => {
    for (const w of ['start posting reels', 'yes but change the photo', 'go']) {
      assert.equal(svc.isResume(w), false, w);
    }
  });
});

describe('notify after STOP', () => {
  function concierge(customer: Row) {
    const sent: string[] = [];
    const prisma = {
      customer: { findUnique: async () => customer },
      conversation: { create: async () => ({ id: 'conv' }) },
      queuedText: { create: async () => ({}) },
    };
    const svc = new ConciergeService(prisma as any, ...(Array(11).fill(undefined) as []));
    (svc as any).reply = async (_to: string, _conv: string, body: string) => sent.push(body);
    return { svc, sent };
  }
  const base = { id: 'c1', phone: '+15550001111', preferredChannel: 'sms', timezone: 'UTC', conversation: { id: 'conv' } };

  it('sends nothing we start to an owner who texted STOP', async () => {
    const { svc, sent } = concierge({ ...base, status: 'paused', pausedReason: 'owner_stop' });
    await svc.notify('c1', 'Your referral just joined', { promptedByOwner: true });
    assert.deepEqual(sent, []);
  });

  it('still reaches a customer paused for billing — that text is how they learn why', async () => {
    const { svc, sent } = concierge({ ...base, status: 'paused', pausedReason: 'billing' });
    await svc.notify('c1', 'Update your card', { promptedByOwner: true });
    assert.deepEqual(sent, ['Update your card']);
  });
});

describe('The texted update-your-card link', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    globalThis.fetch = realFetch;
  });
  const realFetch = globalThis.fetch;

  it('round-trips to the customer it was made for', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_1';
    assert.equal(verifyPortalToken(signPortalToken('cust-1')), 'cust-1');
  });

  it('refuses a tampered, foreign-key or expired token', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_1';
    const t = signPortalToken('cust-1');
    const forged = 's' + Buffer.from('cust-2').toString('base64url') + t.slice(t.indexOf('.'));
    assert.equal(verifyPortalToken(forged), null);
    assert.equal(verifyPortalToken(signPortalToken('cust-1', Date.now() - PORTAL_LINK_TTL_MS - 1)), null);
    process.env.STRIPE_SECRET_KEY = 'sk_test_OTHER';
    assert.equal(verifyPortalToken(t), null);
    assert.equal(verifyPortalToken('garbage'), null);
    assert.equal(verifyPortalToken(undefined), null);
  });

  it('packs a real customer id short enough for a text', () => {
    const id = '938de60f-dde5-46ae-b7ea-e93f67d2e90e';
    const t = signPortalToken(id);
    assert.ok(t.length <= 56, `token is ${t.length} chars`);
    assert.equal(verifyPortalToken(t), id);
  });

  it('points at the site, not the API', () => {
    process.env.PUBLIC_SITE_URL = 'https://texthandled.com';
    assert.match(portalLink('c1'), /^https:\/\/texthandled\.com\/billing\/manage\?t=/);
  });

  it('opens a Stripe portal session for that customer only', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_1';
    const prisma = { customer: { findUnique: async () => ({ stripeCustomerId: 'cus_ABC' }) } };
    let body = '';
    (globalThis as any).fetch = async (url: string, init: any) => {
      assert.equal(url, 'https://api.stripe.com/v1/billing_portal/sessions');
      body = init.body;
      return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/x' }), { status: 200 });
    };
    const svc = new BillingService(prisma as any);
    const out = await svc.createPortalSession(signPortalToken('c1'));
    assert.equal(out?.url, 'https://billing.stripe.com/p/session/x');
    assert.equal(new URLSearchParams(body).get('customer'), 'cus_ABC');
    assert.equal(await svc.createPortalSession('nope'), null);
  });
});

/**
 * QA round 2 (Nov 17): the plan ended at night, the "your subscription has
 * ended" text was held for the morning, and the morning flush dropped it
 * because the account was paused. The Friday recap queued earlier would
 * otherwise have gone out after the plan ended.
 */
describe('texts held for quiet hours around a pause', () => {
  it('a pause or resume clears what was queued before it', async () => {
    const deleted: Row[] = [];
    const prisma = {
      brandProfile: { findUnique: async () => ({ onboardingComplete: true }) },
      customer: { update: async () => ({}) },
      post: { updateMany: async () => ({ count: 0 }) },
      queuedText: { deleteMany: async (a: Row) => void deleted.push(a.where) },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    const h = new PauseCustomerHandler(prisma as any, { cancelAllForCustomer: async () => 0 } as any);
    await h.handle(task({ reason: 'subscription_ended', resume: false }));
    await h.handle(task({ reason: 'billing', resume: true }));
    assert.deepEqual(deleted, [{ customerId: 'c1', sentAt: null }, { customerId: 'c1', sentAt: null }]);
  });

  function flushWorld(customer: Row) {
    const sent: string[] = [];
    const dropped: string[] = [];
    const prisma = {
      queuedText: {
        findMany: async () => [{ id: 'q1', customerId: 'c1', body: 'Your subscription has ended…', customer: { ...customer, conversation: { id: 'conv1' } } }],
        delete: async ({ where }: Row) => void dropped.push(where.id),
        update: async () => ({}),
      },
    };
    const svc = new ConciergeService(prisma as any, ...(Array(11).fill({}) as []));
    (svc as any).reply = async (_to: string, _c: string, body: string) => void sent.push(body);
    return { svc, sent, dropped };
  }
  const base = { id: 'c1', phone: '+13105550000', preferredChannel: 'sms', timezone: 'UTC' };
  // A zone where it is midday right now, so the texting window is open.
  const middayZone = () => {
    let off = 12 - new Date().getUTCHours();
    if (off > 12) off -= 24;
    if (off < -11) off += 24;
    return off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  };
  it('still sends to an ended plan or a billing pause', async () => {
    for (const pausedReason of ['subscription_ended', 'billing']) {
      const w = flushWorld({ ...base, timezone: middayZone(), status: 'paused', pausedReason });
      await w.svc.flushQueuedTexts();
      assert.equal(w.sent.length, 1, pausedReason);
      assert.equal(w.dropped.length, 0, pausedReason);
    }
  });

  it('drops it for an owner who texted STOP', async () => {
    const w = flushWorld({ ...base, status: 'paused', pausedReason: 'owner_stop' });
    await w.svc.flushQueuedTexts();
    assert.deepEqual([w.sent.length, w.dropped], [0, ['q1']]);
  });
});
