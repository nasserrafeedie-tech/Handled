import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PublishGateService } from '../guardrails/publish-gate.service';
import { DraftPostHandler } from './draft-post.handler';

/**
 * Owner feedback: the posts were clean and empty — nobody would stop for them.
 * A first draft that opens on a stock line or names nothing gets one rewrite
 * with the problem named; a good one goes straight through.
 */
function harness(replies: string[], archetype = 'product_spotlight') {
  const prompts: string[] = [];
  const created: Array<{ data: { caption: string } }> = [];
  const prisma = {
    customer: {
      findUnique: async () => ({
        id: 'c1', trustLevel: 'approve_all', timezone: 'America/Los_Angeles',
        planTier: 'starter', aiImagesOptIn: false, businessName: 'Loaf & Co', archetypeSlug: null,
      }),
    },
    brandProfile: {
      findUnique: async () => ({
        businessType: 'bakery', voiceTone: 'dry', targetCustomer: 'neighbours',
        offers: ['Cardamom bun $4.50', 'Country sourdough loaf'], dosAndDonts: [], blackoutTopics: [],
        brandColors: [], businessResearch: null,
      }),
    },
    post: {
      findMany: async () => [],
      create: async (a: { data: { caption: string } }) => (created.push(a), { id: 'p1', scheduledTime: null }),
    },
    mediaAsset: { findFirst: async () => null, findMany: async () => [], update: async () => ({}) },
  };
  const llm = {
    completeJson: async (req: { prompt: string }) => {
      prompts.push(req.prompt);
      return { caption: replies.shift() ?? 'unused', hashtags: ['bakery'], alt_text: 'a bun' };
    },
  };
  const moderation = { screen: async () => ({ passed: true, reasons: [] }) };
  const ctx = { contextBlock: async () => '' };
  const research = { factBlock: async () => null };
  const h = new DraftPostHandler(
    prisma as never, llm as never, moderation as never, new PublishGateService(), ctx as never, research as never,
  );
  const task = {
    task_id: 't1', customer_id: 'c1', type: 'DRAFT_POST',
    payload: { platform: 'instagram', archetype, prompt_notes: '', needs_asset: false },
  };
  return { run: () => h.handle(task as never), prompts, created };
}

describe('DRAFT_POST asks for substance', () => {
  it('tells the writer which angle to take and to carry a payload', async () => {
    const t = harness(['The cardamom bun is $4.50 and it goes first. Text us to hold one.']);
    await t.run();
    assert.match(t.prompts[0], /THE ANGLE FOR THIS POST/);
    assert.match(t.prompts[0], /THE PAYLOAD/);
  });

  it('rewrites a stock, empty first draft once, naming the problem', async () => {
    const t = harness([
      'Happy Monday, neighbours! Come see us this week. See you soon.',
      'If you only get one thing, get the cardamom bun. $4.50, and it goes by 10. Text us to hold one.',
    ]);
    const r = await t.run();
    assert.ok(!r.error);
    assert.equal(t.prompts.length, 2);
    assert.match(t.prompts[1], /stock opener/);
    assert.match(t.prompts[1], /filler/);
    assert.match(t.created[0].data.caption, /cardamom bun/);
  });

  it('keeps the first draft when the rewrite is no better', async () => {
    const first = 'Happy Monday! Come see us. See you soon.';
    const t = harness([first, 'Happy Tuesday! Stop by. See you soon. Made with love.']);
    await t.run();
    assert.equal(t.created[0].data.caption, first);
  });

  it('does not spend a second call on a draft that already lands', async () => {
    const t = harness(['Most people store sourdough in the fridge. Keep it cut-side down on the board instead. Save this.']);
    await t.run();
    assert.equal(t.prompts.length, 1);
  });
});
