import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

import { ConciergeService, type InboundSms } from './concierge.service';

/**
 * The paywall free taste (§ pricing): a new number gets exactly one drafted
 * caption, then static paywall replies until they pay. These tests drive the
 * REAL handleInbound path with fake deps, because the property that matters is
 * placement: the gate must sit below STOP/HELP (carrier compliance) and above
 * media ingest + onboarding (the paid product).
 *
 * The bug this guards: text-to-join creating a customer and walking straight
 * into full onboarding — the entire paid service delivered free to anyone who
 * texted the number.
 */

type Row = Record<string, unknown>;

function makeWorld(opts?: { usedToday?: number; llmFails?: boolean }) {
  const sent: string[] = [];
  const updates: Row[] = [];
  const emitted: string[] = [];
  let llmCalls = 0;

  const customers = new Map<string, Row>();

  const prisma = {
    customer: {
      findUnique: async ({ where }: { where: Row }) => {
        const key = (where.phone ?? where.email ?? where.id) as string;
        const c = customers.get(key);
        return c ? { ...c, conversation: { id: 'conv1' } } : null;
      },
      create: async ({ data }: { data: Row }) => {
        const key = (data.phone ?? data.email) as string;
        const row = {
          id: 'cust1',
          phone: (data.phone as string) ?? null,
          email: (data.email as string) ?? null,
          preferredChannel: (data.preferredChannel as string) ?? 'sms',
          stripeCustomerId: null,
          freeDraftUsedAt: null,
          planTier: 'starter',
        };
        customers.set(key, row);
        return { ...row, conversation: { id: 'conv1' } };
      },
      count: async () => opts?.usedToday ?? 0,
      update: async (args: { where: Row; data: Row }) => {
        updates.push(args.data);
        for (const [k, v] of customers) {
          customers.set(k, { ...v, ...args.data });
        }
        return {};
      },
    },
    conversation: { create: async () => ({ id: 'conv1' }) },
    message: { create: async () => ({}) },
    brandProfile: { findUnique: async () => null },
    post: { findFirst: async () => null },
    shotListRequest: { findFirst: async () => null },
  };

  const svc = new ConciergeService(
    prisma as never,
    // TaskBus — emitting a task means the gate leaked into the paid product.
    {
      emit: async (t: { type: string }) => {
        emitted.push(t.type);
        return { summary_for_owner: 'ok' };
      },
    } as never,
    { send: async (_to: string, body: string) => void sent.push(body) } as never, // twilio
    { send: async (_to: string, body: string) => void sent.push(body) } as never, // email
    // onboarding — reaching the interview unpaid is the leak.
    {
      isComplete: () => {
        throw new Error('onboarding reached by unpaid customer');
      },
      nextField: () => 'business_type',
      welcome: () => 'welcome',
      question: () => 'q',
    } as never,
    { classify: async () => ({ intent: 'other', confidence: 1 }) } as never, // intent
    {
      completeJson: async () => {
        llmCalls++;
        if (opts?.llmFails) throw new Error('llm down');
        return { caption: 'Fresh sourdough every morning. #bakery' };
      },
    } as never, // llm
    {} as never, // playbook
    {} as never, // classifier
    {} as never, // research
  );

  const seed = (row: Row) => customers.set(row.phone as string, row);
  return { svc, sent, updates, emitted, seed, llmCalls: () => llmCalls };
}

const sms = (body: string, from = '+15550001111'): InboundSms => ({
  from,
  body,
  mediaUrls: [],
  mediaContentTypes: [],
});

const UNPAID = {
  id: 'cust1',
  phone: '+15550001111',
  email: null,
  preferredChannel: 'sms',
  stripeCustomerId: null,
  freeDraftUsedAt: null,
  planTier: 'starter',
};

describe('free-taste paywall', () => {
  let world: ReturnType<typeof makeWorld>;
  beforeEach(() => (world = makeWorld()));

  it('brand-new number → opt-in disclosure then the free-taste intro, no LLM', async () => {
    await world.svc.handleInbound(sms('HANDLED'));
    assert.equal(world.sent.length, 2, 'disclosure + intro');
    assert.match(world.sent[0], /opted in/i);
    assert.match(world.sent[1], /free/i);
    assert.equal(world.llmCalls(), 0);
    assert.deepEqual(world.emitted, [], 'no tasks for unpaid customers');
  });

  it("the blurb reply → one drafted caption + pitch, and the taste is stamped", async () => {
    world.seed({ ...UNPAID });
    await world.svc.handleInbound(sms('I run a bakery, promote our sourdough'));
    assert.equal(world.sent.length, 1);
    assert.match(world.sent[0], /sourdough/i);
    assert.match(world.sent[0], /billing/i, 'pitch with checkout link');
    assert.equal(world.updates.length, 1, 'freeDraftUsedAt stamped');
    assert.ok(world.updates[0].freeDraftUsedAt instanceof Date);
  });

  it('after the taste, unpaid texts get the static paywall reply with ZERO llm calls', async () => {
    world.seed({ ...UNPAID, freeDraftUsedAt: new Date() });
    await world.svc.handleInbound(sms('give me another post'));
    await world.svc.handleInbound(sms('please?'));
    assert.equal(world.sent.length, 2);
    for (const s of world.sent) assert.match(s, /billing/i);
    assert.equal(world.llmCalls(), 0, 'paywall replies must cost nothing');
    assert.deepEqual(world.emitted, []);
  });

  it('STOP still works above the gate for unpaid customers', async () => {
    world.seed({ ...UNPAID, freeDraftUsedAt: new Date() });
    await world.svc.handleInbound(sms('STOP'));
    assert.deepEqual(world.emitted, ['PAUSE_CUSTOMER']);
  });

  it('HELP still works above the gate for unpaid customers', async () => {
    world.seed({ ...UNPAID, freeDraftUsedAt: new Date() });
    await world.svc.handleInbound(sms('HELP'));
    assert.equal(world.sent.length, 1);
    assert.match(world.sent[0], /STOP to cancel/i);
    assert.equal(world.llmCalls(), 0);
  });

  it('daily cap reached → capacity reply, nothing stamped (they can retry tomorrow)', async () => {
    world = makeWorld({ usedToday: 25 });
    world.seed({ ...UNPAID });
    await world.svc.handleInbound(sms('I run a bakery'));
    assert.equal(world.sent.length, 1);
    assert.match(world.sent[0], /capacity|tomorrow/i);
    assert.equal(world.llmCalls(), 0, 'cap check must precede the LLM call');
    assert.equal(world.updates.length, 0, 'a capped lead keeps their taste');
  });

  it('LLM failure → apology, NOT stamped — the taste is still owed', async () => {
    world = makeWorld({ llmFails: true });
    world.seed({ ...UNPAID });
    await world.svc.handleInbound(sms('I run a bakery'));
    assert.equal(world.sent.length, 1);
    assert.match(world.sent[0], /snag|again/i);
    assert.equal(world.updates.length, 0);
  });

  it('the opt-in keyword from an EXISTING customer re-asks — never becomes the blurb', async () => {
    // The bug: a reset/re-engaged customer texting HANDLED got a caption about
    // the word "handled" — their one free taste spent on nothing.
    world.seed({ ...UNPAID });
    for (const kw of ['Handled', 'HANDLED', 'start', 'yes', 'hi', 'Hey!']) {
      world.sent.length = 0;
      await world.svc.handleInbound(sms(kw));
      assert.equal(world.sent.length, 1, `"${kw}" should get exactly one reply`);
      assert.match(world.sent[0], /text me back|free/i, `"${kw}" must re-ask, not draft`);
    }
    assert.equal(world.llmCalls(), 0, 'keywords must never reach the LLM');
    assert.equal(world.updates.length, 0, 'keywords must not spend the taste');
  });

  it('an empty body (photo only) re-asks instead of drafting from nothing', async () => {
    world.seed({ ...UNPAID });
    await world.svc.handleInbound({ ...sms('   '), mediaUrls: ['https://x/y.jpg'], mediaContentTypes: ['image/jpeg'] });
    assert.equal(world.sent.length, 1);
    assert.match(world.sent[0], /text me back|free/i);
    assert.equal(world.llmCalls(), 0);
    assert.deepEqual(world.emitted, [], 'unpaid media must not reach INGEST_MEDIA');
  });

  it('a PAID customer sails past the gate into the real product', async () => {
    world.seed({ ...UNPAID, stripeCustomerId: 'cus_123' });
    // onboarding.isComplete throws in this harness — reaching it IS the proof
    // the gate let a paying customer through.
    await assert.rejects(
      () => world.svc.handleInbound(sms('hello')),
      /onboarding reached/,
    );
  });
});
