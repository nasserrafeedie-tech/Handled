import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

import { ConciergeService, aboutHandled, isPriceQuestion, type InboundSms } from './concierge.service';

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

function makeWorld(opts?: { usedToday?: number; llmFails?: boolean; alertFails?: boolean }) {
  const sent: string[] = [];
  const outbound: Array<{ to: string; body: string }> = [];
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
    {
      send: async (to: string, body: string) => {
        outbound.push({ to, body });
        // The lead-alert number is distinct from any customer address, so a
        // configured failure hits only the alert — never the sale text.
        if (opts?.alertFails && to === process.env.LEAD_ALERT_PHONE) {
          throw new Error('twilio down for alerts');
        }
        sent.push(body);
      },
    } as never, // twilio
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
    // business lookup — never reached in the free-taste lane.
    { pending: () => undefined, lookUp: async () => null } as never,
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
    { publicUrl: (k: string) => `https://cdn.test/${k}` } as never, // storage
  );

  const seed = (row: Row) => customers.set(row.phone as string, row);
  return { svc, sent, outbound, updates, emitted, seed, llmCalls: () => llmCalls };
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

  it('"how much is it?" gets the prices, not the paywall text or a wasted draft (F3)', async () => {
    world.seed({ ...UNPAID });
    for (const q of ['how much is it?', 'Pricing?', 'what does it cost', 'How much per month']) {
      world.sent.length = 0;
      await world.svc.handleInbound(sms(q));
      assert.equal(world.sent.length, 1, q);
      assert.match(world.sent[0], /\$95.*\$349.*\$699/, q);
      assert.match(world.sent[0], /free sample/, `${q}: the draft is still theirs, so say so`);
    }
    assert.equal(world.llmCalls(), 0, 'a price question must not reach the LLM');
    assert.equal(world.updates.length, 0, 'a price question must not spend the free draft');
  });

  it('after the free draft, the price question still gets prices, without offering another draft', async () => {
    world.seed({ ...UNPAID, freeDraftUsedAt: new Date() });
    await world.svc.handleInbound(sms('how much?'));
    assert.match(world.sent[0], /\$95/);
    assert.doesNotMatch(world.sent[0], /free sample/);
  });

  it('"sign me up" gets the plan link and keeps the free draft unspent', async () => {
    world.seed({ ...UNPAID });
    for (const q of ['ok sign me up for starter', 'how do I pay?', "I'm in"]) {
      world.sent.length = 0;
      await world.svc.handleInbound(sms(q));
      assert.equal(world.sent.length, 1, q);
      assert.match(world.sent[0], /texthandled\.com\/billing/, q);
      assert.match(world.sent[0], /free sample/, q);
    }
    assert.equal(world.llmCalls(), 0);
    assert.equal(world.updates.length, 0, 'asking to sign up must not spend the free draft');
  });

  it('"how does this work?" gets what Handled does, not a post about the question', async () => {
    world.seed({ ...UNPAID });
    await world.svc.handleInbound(sms('how does this work?'));
    assert.match(world.sent[0], /plan, write, design and post/);
    assert.equal(world.llmCalls(), 0);
    assert.equal(world.updates.length, 0);
  });

  it('"what do you actually do" is the same question (QA round 6)', () => {
    for (const q of ['what do you actually do', 'what does handled do', 'what exactly do you do', 'what does this actually do?']) {
      assert.equal(aboutHandled(q), 'how', q);
    }
  });

  it('a description that starts like an ask is still the description', () => {
    for (const d of ["I'm in Austin, I run a bakery", 'we help people get started with yoga', "Buy one get one free on Tuesdays at Joe's Pizza", 'start', 'join']) {
      assert.equal(aboutHandled(d), null, d);
    }
  });

  it('a business description that mentions its own prices is still the description', () => {
    assert.equal(isPriceQuestion('I run a bakery, our cakes cost less than the supermarket and everything is baked daily'), false);
    assert.equal(isPriceQuestion('I run a bakery'), false);
    assert.equal(isPriceQuestion('whats the price'), true);
  });

  it('an email signup that gave its name gets an intro that uses it (F18)', async () => {
    // beginOnboarding looks the customer up by id, and the fake keys rows by
    // phone, so the row is stored under its id.
    world.seed({ ...UNPAID, phone: 'cust1', businessName: 'Fieldnote Florals' });
    await world.svc.beginOnboarding('cust1');
    assert.match(world.sent.join(' '), /what Fieldnote Florals does/);
  });

  it('an empty body (photo only) re-asks instead of drafting from nothing', async () => {
    world.seed({ ...UNPAID });
    await world.svc.handleInbound({ ...sms('   '), mediaUrls: ['https://x/y.jpg'], mediaContentTypes: ['image/jpeg'] });
    assert.equal(world.sent.length, 1);
    assert.match(world.sent[0], /text me back|free/i);
    assert.equal(world.llmCalls(), 0);
    assert.deepEqual(world.emitted, [], 'unpaid media must not reach INGEST_MEDIA');
  });

  describe('lead alert (LEAD_ALERT_PHONE)', () => {
    const OWNER = '+15559998888';

    it('set → Nasser gets one alert AFTER the taste is delivered, with contact + blurb + caption', async () => {
      process.env.LEAD_ALERT_PHONE = OWNER;
      try {
        world.seed({ ...UNPAID });
        await world.svc.handleInbound(sms('I run a bakery, promote our sourdough'));
        const alerts = world.outbound.filter((o) => o.to === OWNER);
        assert.equal(alerts.length, 1, 'exactly one alert per taste');
        assert.match(alerts[0].body, /\+15550001111/, 'the lead\'s number, so he can text back');
        assert.match(alerts[0].body, /bakery/i, 'what they said');
        assert.match(alerts[0].body, /sourdough/i, 'what we sent them');
        // Ordering: the sale text must leave before the notification.
        const lastIdx = world.outbound.length - 1;
        assert.equal(world.outbound[lastIdx].to, OWNER, 'alert goes out last');
      } finally {
        delete process.env.LEAD_ALERT_PHONE;
      }
    });

    it('unset (the default) → no alert, outbound is only the customer text', async () => {
      world.seed({ ...UNPAID });
      await world.svc.handleInbound(sms('I run a bakery'));
      assert.equal(world.outbound.length, 1);
      assert.equal(world.outbound[0].to, '+15550001111');
    });

    it('a failed alert never breaks the lead\'s flow — draft delivered, taste stamped', async () => {
      process.env.LEAD_ALERT_PHONE = OWNER;
      try {
        world = makeWorld({ alertFails: true });
        world.seed({ ...UNPAID });
        await world.svc.handleInbound(sms('I run a bakery'));
        assert.equal(world.sent.length, 1, 'the customer draft still went out');
        assert.match(world.sent[0], /billing/i);
        assert.equal(world.updates.length, 1, 'freeDraftUsedAt still stamped');
      } finally {
        delete process.env.LEAD_ALERT_PHONE;
      }
    });

    it('no alert on intro, keywords, paywall, or cap — only a delivered taste', async () => {
      process.env.LEAD_ALERT_PHONE = OWNER;
      try {
        // Brand-new number (intro) + keyword re-ask.
        await world.svc.handleInbound(sms('HANDLED'));
        await world.svc.handleInbound(sms('hi'));
        // Stamped customer hitting the paywall.
        world.seed({ ...UNPAID, phone: '+15550002222', freeDraftUsedAt: new Date() });
        await world.svc.handleInbound(sms('another?', '+15550002222'));
        assert.equal(world.outbound.filter((o) => o.to === OWNER).length, 0);
      } finally {
        delete process.env.LEAD_ALERT_PHONE;
      }
    });
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
