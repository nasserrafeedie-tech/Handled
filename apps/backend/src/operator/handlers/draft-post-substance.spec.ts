import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PublishGateService } from '../guardrails/publish-gate.service';
import { DraftPostHandler } from './draft-post.handler';

/**
 * Owner feedback: the posts were clean and empty — nobody would stop for them.
 * A first draft that opens on a stock line or names nothing gets one rewrite
 * with the problem named; a good one goes straight through.
 */
function harness(replies: string[], archetype = 'product_spotlight', verdicts: Array<{ stops: boolean; problem?: string }> = []) {
  const prompts: string[] = [];
  const judged: string[] = [];
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
    completeJson: async (req: { prompt: string; tier: string }) => {
      if (req.tier === 'bulk') {
        judged.push(req.prompt);
        return verdicts.shift() ?? { stops: true, payload: 'something', problem: null };
      }
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
  return { run: () => h.handle(task as never), prompts, created, judged };
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

  it('rewrites a clean but empty draft the scroll test fails', async () => {
    const t = harness(
      [
        'Your smile is our top priority. Our team is here for you every step of the way.',
        'Most bleeding gums are a flossing problem, not a brushing one. Floss the back teeth first. Save this.',
      ],
      'educational_tip',
      [{ stops: false, problem: 'Nothing concrete; tell the reader something to do.' }, { stops: true }],
    );
    await t.run();
    assert.equal(t.prompts.length, 2);
    assert.match(t.prompts[1], /skeptical reader would scroll past this: Nothing concrete/);
    assert.match(t.created[0].data.caption, /bleeding gums/);
    assert.equal(t.judged.length, 2, 'the rewrite is judged again');
  });

  it('keeps the first draft when the judge fails the rewrite too', async () => {
    const first = 'Your smile is our top priority. Our team is here for you.';
    const t = harness([first, 'Healthy smiles start here. We care about you.'], 'educational_tip', [
      { stops: false, problem: 'Generic.' },
      { stops: false, problem: 'Still generic.' },
    ]);
    await t.run();
    assert.equal(t.created[0].data.caption, first);
  });

  it('skips the judge when the patterns already failed the draft', async () => {
    const t = harness([
      'Happy Monday, neighbours! Come see us this week. See you soon.',
      'If you only get one thing, get the cardamom bun. $4.50, and it goes by 10.',
    ]);
    await t.run();
    assert.equal(t.judged.length, 0);
  });
});
