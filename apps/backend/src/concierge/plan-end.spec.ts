import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConciergeService, CANCEL_PLAN_RE, BARE_CANCEL_RE } from './concierge.service';

/**
 * Ending the plan, from the owner's side.
 *
 * Before: "I want to cancel my subscription" fell through to the draft queue
 * and got "Reply yes to send that draft". And once Stripe ended the plan, the
 * customer was paused as if a card had failed, so every later text told them
 * their payment didn't go through and sent a card link that can't restart an
 * ended plan.
 */

type Row = Record<string, any>;

function world(customer: Row) {
  const sent: string[] = [];
  const emitted: string[] = [];
  const prisma = {
    customer: { findUnique: async () => ({ ...customer, conversation: { id: 'conv1' } }) },
    conversation: { create: async () => ({ id: 'conv1' }) },
    message: { create: async () => ({}), findFirst: async () => null },
    brandProfile: { findUnique: async () => ({}) },
    post: { findFirst: async () => null },
    shotListRequest: { findFirst: async () => null },
  };
  const svc = new ConciergeService(
    prisma as never,
    { emit: async (t: { type: string }) => (emitted.push(t.type), { summary_for_owner: 'ok' }) } as never,
    { send: async (_to: string, body: string) => void sent.push(body) } as never,
    { send: async (_to: string, body: string) => void sent.push(body) } as never,
    { isComplete: () => true, nextField: () => null, question: () => 'q' } as never,
    { pending: () => undefined, lookUp: async () => null } as never,
    { classify: async () => ({ intent: 'other', confidence: 1 }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { publicUrl: (k: string) => k } as never,
  );
  (svc as any).reply = async (_to: string, _conv: string, body: string) => void sent.push(body);
  return { svc, sent, emitted };
}

const sms = (body: string) => ({ from: '+15550001111', body, mediaUrls: [], mediaContentTypes: [] });
const PAID = { id: 'c1', phone: '+15550001111', preferredChannel: 'sms', stripeCustomerId: 'cus_1', planTier: 'growth', timezone: 'UTC' };

describe('Asking to cancel the plan', () => {
  it('gets the billing page, not the draft queue', async () => {
    const { svc, sent, emitted } = world({ ...PAID, status: 'active' });
    await svc.handleInbound(sms('I want to cancel my subscription'));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /\/billing\/manage\?t=/);
    assert.doesNotMatch(sent[0], /draft/i);
    assert.deepEqual(emitted, []);
  });

  it('matches plan cancels but not post cancels', () => {
    for (const t of ['cancel my subscription', 'How do I cancel?', 'I want to end my plan', 'stop the service', 'cancel my membership please']) {
      assert.ok(CANCEL_PLAN_RE.test(t), t);
    }
    for (const t of ['cancel it', 'cancel the post', "cancel tomorrow's post", 'how do i cancel a post', 'skip this one', 'stop']) {
      assert.ok(!CANCEL_PLAN_RE.test(t), t);
    }
  });

  it('asks which, for a bare "I want to cancel" (QA round 5)', () => {
    for (const t of ['I want to cancel', "i'd like to cancel.", 'i wanna cancel', 'can I cancel?', 'cancel please']) {
      assert.ok(BARE_CANCEL_RE.test(t), t);
    }
    for (const t of ['cancel it', 'I want to cancel my plan', 'cancel', 'i want to cancel the friday post']) {
      assert.ok(!BARE_CANCEL_RE.test(t), t);
    }
  });
});

describe('Texting after the plan ended', () => {
  it('says the plan ended and links to pick a plan, not a card update', async () => {
    const { svc, sent } = world({ ...PAID, status: 'paused', pausedReason: 'subscription_ended' });
    await svc.handleInbound(sms('hey can you post this weekend?'));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /subscription has ended/);
    assert.match(sent[0], /\/billing$/);
    assert.doesNotMatch(sent[0], /payment|card/i);
  });

  it('a billing pause still sends the card link', async () => {
    const { svc, sent } = world({ ...PAID, status: 'paused', pausedReason: 'billing' });
    await svc.handleInbound(sms('hello?'));
    assert.match(sent[0], /didn't go through/);
  });
});
