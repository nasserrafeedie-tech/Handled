import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PublishGateService } from '../guardrails/publish-gate.service';
import { RegeneratePostHandler } from './regenerate-post.handler';

/**
 * A revise that comes back word for word must not be presented as
 * "Reworked it" — the owner would see the same post and think we ignored them.
 */
function harness(replies: string[]) {
  const updates: unknown[] = [];
  const prompts: string[] = [];
  const post = { id: 'p1', customerId: 'c1', archetype: 'promo', platform: 'instagram', caption: 'Fresh bread at 7.', mediaRefs: [], scheduledTime: null };
  const prisma = {
    post: { findFirst: async () => post, update: async (a: unknown) => (updates.push(a), a) },
    brandProfile: { findUnique: async () => ({ blackoutTopics: [], offers: [], dosAndDonts: [], brandColors: [] }) },
    customer: { findUnique: async () => ({ trustLevel: 'approve_all' }) },
  };
  const llm = {
    completeJson: async (req: { prompt: string }) => {
      prompts.push(req.prompt);
      return { caption: replies.shift() ?? 'Fresh bread at 7.', hashtags: [] };
    },
  };
  const moderation = { screen: async () => ({ passed: true, reasons: [] }) };
  const ctx = { learnFromFeedback: async () => undefined, contextBlock: async () => '' };
  const h = new RegeneratePostHandler(prisma as never, llm as never, moderation as never, new PublishGateService(), ctx as never);
  const task = { task_id: 't1', customer_id: 'c1', type: 'REGENERATE_POST', payload: { post_id: 'p1', owner_feedback: 'mention croissants' } };
  return { run: () => h.handle(task as never), updates, prompts };
}

describe('REGENERATE_POST when the rewrite repeats itself', () => {
  it('asks again once, and uses the second answer when it differs', async () => {
    const t = harness(['Fresh bread at 7.', 'Croissants come out at 7. Get there early.']);
    const r = await t.run();
    assert.ok(!r.error);
    assert.equal(t.prompts.length, 2);
    assert.match(t.prompts[1], /clearly different/);
    assert.equal(t.updates.length, 1);
  });

  it('tells the owner it came back the same instead of claiming a rework', async () => {
    const t = harness(['Fresh bread at 7.', '  fresh bread at 7. ']);
    const r = await t.run();
    assert.ok(r.error);
    assert.match(r.summary_for_owner, /came back the same/);
    assert.doesNotMatch(r.summary_for_owner, /Reworked/);
    assert.equal(t.updates.length, 0, 'the post must not be touched');
  });

  it('does not retry a rewrite that already changed', async () => {
    const t = harness(['Croissants at 7.']);
    await t.run();
    assert.equal(t.prompts.length, 1);
  });
});
