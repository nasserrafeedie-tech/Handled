import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Task } from '@smm/contracts';

import { DEMO_BUSINESSES, demoView, nextMonday, runDemoWeek, setUpDemoAccount } from './demo-week';
import { DEMO_STRIPE_PREFIX, NOT_DEMO } from './internal-accounts';
import { DEMO_PAGE_HTML } from './demo-page';
import { ADMIN_PAGE_HTML } from './admin-page';

type Row = Record<string, any>;
const biz = DEMO_BUSINESSES['south-bay-dental-smiles'];

function accountDb(rows: Row[] = []) {
  const profiles: Row[] = [];
  const prisma = {
    customer: {
      findUnique: async ({ where }: Row) => rows.find((r) => r.stripeCustomerId === where.stripeCustomerId) ?? null,
      update: async ({ where, data }: Row) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      create: async ({ data }: Row) => {
        const row = { id: `c${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
    },
    brandProfile: { upsert: async ({ create, update }: Row) => void profiles.push({ create, update }) },
    conversation: { upsert: async () => ({}) },
  };
  return { prisma: prisma as never, rows, profiles };
}

const slot = (date: string, archetype: string, extra: Row = {}) => ({
  date, archetype, platform: 'instagram', best_time: '09:00', needs_asset: false, ...extra,
});

function pipeline(opts: {
  customer?: Row | null;
  slots?: Row[];
  draft?: (t: Task, n: number) => Row;
  media?: string[];
}) {
  const emitted: Task[] = [];
  let n = 0;
  const deps = {
    prisma: {
      customer: {
        findUnique: async () =>
          opts.customer === undefined
            ? { timezone: 'America/Los_Angeles', planTier: 'pro', status: 'paused', phone: null, email: null }
            : opts.customer,
      },
      post: { findUnique: async () => ({ mediaRefs: opts.media ?? ['k1'] }) },
    } as never,
    emit: async (t: Task) => {
      emitted.push(t);
      if (t.type === 'PLAN_WEEK') return { status: 'done', data: { slots: opts.slots ?? [] } } as never;
      if (t.type === 'DRAFT_POST') {
        const i = ++n;
        return { status: 'pending_approval', data: opts.draft ? opts.draft(t, i) : { post_id: `p${i}`, needs_carousel: true } } as never;
      }
      return { status: 'done', data: null } as never;
    },
  };
  return { deps, emitted };
}

describe('demo week account', () => {
  it('is a Pro account that cannot be texted or posted from', async () => {
    const w = accountDb();
    const id = await setUpDemoAccount(w.prisma, biz);
    const row = w.rows[0];
    assert.equal(row.id, id);
    assert.equal(row.stripeCustomerId, `${DEMO_STRIPE_PREFIX}south-bay-dental-smiles`);
    assert.equal(row.phone, null);
    assert.equal(row.email, null);
    assert.equal(row.status, 'paused', 'every sweep that texts or publishes skips a paused account');
    assert.equal(row.planTier, 'pro');
    assert.equal(row.trustLevel, 'approve_all', 'every draft waits on a yes nobody gives');
    assert.equal(w.profiles[0].create.onboardingComplete, true);
  });

  it('refreshes the same account on a second run', async () => {
    const w = accountDb();
    const a = await setUpDemoAccount(w.prisma, biz);
    const b = await setUpDemoAccount(w.prisma, biz);
    assert.equal(a, b);
    assert.equal(w.rows.length, 1);
  });

  it('gives the writer real facts and forbids invented ones', () => {
    const p = biz.profile as { offers: string[]; dosAndDonts: string[]; businessResearch: string };
    assert.ok(p.offers.some((o) => /\$33 a month/.test(o)));
    assert.match(p.businessResearch, /Monday to Thursday/);
    assert.ok(p.dosAndDonts.some((d) => /Do not invent patient/.test(d)));
  });

  it('is left out of customer counts and the approval queue', () => {
    assert.deepEqual(NOT_DEMO.OR[0], { stripeCustomerId: null });
    assert.deepEqual(NOT_DEMO.OR[1], { NOT: { stripeCustomerId: { startsWith: DEMO_STRIPE_PREFIX } } });
  });
});

describe('runDemoWeek', () => {
  it('plans a full week and makes every post with its visual, and nothing else', async () => {
    const t = pipeline({
      slots: [slot('2026-11-30', 'educational_tip'), slot('2026-12-01', 'behind_the_scenes', { needs_asset: true, shot_list: 'the front desk' })],
      draft: (_t, i) => (i === 1 ? { post_id: 'p1', needs_carousel: true } : { post_id: 'p2', needs_image: true }),
    });
    const run = await runDemoWeek(t.deps, 'c1', 'south-bay-dental-smiles');
    assert.equal(run.step, 'done');
    assert.equal(run.planned, 2);
    assert.equal(run.drafted, 2);
    const plan = t.emitted.find((e) => e.type === 'PLAN_WEEK')!;
    assert.equal((plan.payload as Row).posting_frequency, 7);
    const drafts = t.emitted.filter((e) => e.type === 'DRAFT_POST');
    assert.ok(drafts.every((d) => (d.payload as Row).needs_asset === false), 'every post gets a generated visual');
    assert.deepEqual(
      [...new Set(t.emitted.map((e) => e.type))].sort(),
      ['DRAFT_POST', 'GENERATE_CAROUSEL', 'GENERATE_IMAGE', 'PLAN_WEEK'],
      'never schedules, publishes or texts',
    );
    assert.equal(run.notes.find((n) => n.postId === 'p2')?.photoAsk, 'the front desk', 'says where a real owner would be asked');
  });

  it('adds a carousel when a post came out with no visual', async () => {
    const t = pipeline({ slots: [slot('2026-11-30', 'were_open')], draft: () => ({ post_id: 'p1', needs_image: true }), media: [] });
    await runDemoWeek(t.deps, 'c1', 'x');
    assert.ok(t.emitted.some((e) => e.type === 'GENERATE_CAROUSEL'));
  });

  it('refuses an account that could text or post, before spending anything', async () => {
    for (const customer of [
      { timezone: 'America/Los_Angeles', planTier: 'pro', status: 'active', phone: null, email: null },
      { timezone: 'America/Los_Angeles', planTier: 'pro', status: 'paused', phone: '+13105550100', email: null },
      { timezone: 'America/Los_Angeles', planTier: 'pro', status: 'paused', phone: null, email: 'a@b.co' },
      null,
    ]) {
      const t = pipeline({ customer, slots: [slot('2026-11-30', 'promo')] });
      const run = await runDemoWeek(t.deps, 'c1', 'x');
      assert.equal(run.step, 'stopped');
      assert.equal(t.emitted.length, 0);
    }
  });

  it('keeps going when one post fails, and says which', async () => {
    const t = pipeline({
      slots: [slot('2026-11-30', 'promo'), slot('2026-12-01', 'educational_tip')],
      draft: (_t, i) => (i === 1 ? {} : { post_id: 'p2', needs_carousel: true }),
    });
    const run = await runDemoWeek(t.deps, 'c1', 'x');
    assert.equal(run.drafted, 1);
    assert.equal(run.problems.length, 1);
    assert.equal(run.step, 'done');
  });

  it('stops with a reason when the planner returns nothing', async () => {
    const t = pipeline({ slots: [] });
    const run = await runDemoWeek(t.deps, 'c1', 'x');
    assert.equal(run.step, 'stopped');
    assert.match(run.problems[0], /no posts/);
    assert.equal(t.emitted.filter((e) => e.type === 'PLAN_WEEK').length, 2, 'one retry');
  });

  it('plans from the next Monday', () => {
    assert.equal(nextMonday(new Date('2026-11-24T18:00:00Z')), '2026-11-30T00:00:00.000Z');
    assert.equal(nextMonday(new Date('2026-11-30T18:00:00Z')), '2026-12-07T00:00:00.000Z');
  });
});

describe('demoView', () => {
  it('shows each post with its media, the models and what the run cost', async () => {
    const t = pipeline({ slots: [slot('2026-11-30', 'behind_the_scenes', { needs_asset: true, shot_list: 'the team' })], draft: () => ({ post_id: 'p1' }) });
    await runDemoWeek(t.deps, 'c9', 'south-bay-dental-smiles');
    const prisma = {
      post: {
        findFirst: async () => null,
        findMany: async () => [
          {
            id: 'p1', scheduledTime: new Date('2026-11-30T17:00:00Z'), platform: 'instagram', archetype: 'behind_the_scenes',
            caption: 'Most first visits start with a chat, not a chair.', hashtags: ['torrance'], altText: 'a dental chair',
            mediaRefs: ['posts/p1/1.png', 'https://cdn.example/2.png'], aiGeneratedMedia: true, status: 'pending_approval',
          },
        ],
      },
      llmUsage: {
        findMany: async () => [
          { model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          { model: 'claude-fable-5-2', inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
        ],
      },
    };
    const v = await demoView(prisma as never, (k) => `https://media.example/${k}`, 'c9', biz);
    assert.equal(v.business, 'South Bay Dental Smiles');
    assert.deepEqual(v.posts[0].media, ['https://media.example/posts/p1/1.png', 'https://cdn.example/2.png']);
    assert.equal(v.posts[0].photoAsk, 'the team');
    assert.equal(v.spend.usd, 9);
    assert.equal(v.models.designs, process.env.LLM_MODEL_DESIGN ?? 'claude-fable-5-2');
    assert.equal(v.run?.step, 'done');
  });
});

describe('demo page', () => {
  it('asks for the token in the browser and sends it as a header', () => {
    assert.match(DEMO_PAGE_HTML, /'x-admin-token':TOKEN/);
    assert.match(DEMO_PAGE_HTML, /api\('\/admin\/demo-week'/);
    assert.doesNotMatch(DEMO_PAGE_HTML, /\?token=/);
  });

  it('states the cost before it spends anything', () => {
    assert.match(DEMO_PAGE_HTML, /confirm\('This makes a full week[^']*about \$7/);
  });

  it('is linked from the operator page', () => {
    assert.match(ADMIN_PAGE_HTML, /href="\/admin\/demo"/);
  });
});
