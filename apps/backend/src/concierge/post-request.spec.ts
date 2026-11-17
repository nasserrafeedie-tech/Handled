import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService, looksLikePostRequest } from './concierge.service';
import { PlanWeekHandler, assignOwnerRequests, ownerRequestNote } from '../operator/handlers/plan-week.handler';

/**
 * QA round 2 (Nov 17): with every post already out, the owner texted "can you
 * make the next one about our $25 cuts" and got "Nothing's waiting on your OK
 * right now". The ask was dropped. Now the next scheduled post is rewritten
 * around it, or the next plan gives it a slot.
 */
function concierge(opts: { next?: { id: string; mediaRefs: string[] } | null; requests?: string[] }) {
  const sent: string[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const profileUpdates: Array<Record<string, unknown>> = [];
  const postUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    post: {
      findFirst: async () => opts.next ?? null,
      update: async ({ data }: { data: Record<string, unknown> }) => void postUpdates.push(data),
    },
    mediaAsset: { findFirst: async () => null },
    brandProfile: {
      findUnique: async () => ({ postRequests: opts.requests ?? [] }),
      update: async ({ data }: { data: Record<string, unknown> }) => void profileUpdates.push(data),
    },
  };
  const bus = {
    emit: async (t: { type: string; payload: Record<string, unknown> }) => {
      emitted.push(t);
      return { summary_for_owner: 'ok' };
    },
  };
  const svc = new ConciergeService(prisma as never, bus as never, ...(Array(10).fill({}) as [never]));
  (svc as any).reply = async (_to: string, _c: string, body: string) => void sent.push(body);
  const shown: string[] = [];
  (svc as any).presentNextDraft = async (_id: string, lead: string, o: { postId: string }) => {
    shown.push(`${lead} ${o.postId}`);
    return true;
  };
  const ask = (text: string) => (svc as any).takePostRequest('c1', '+1555', 'conv1', text);
  return { ask, sent, emitted, profileUpdates, postUpdates, shown };
}

describe('a post the owner asks for with nothing waiting', () => {
  it('reads a post request apart from a tweak to a draft that is not there', () => {
    for (const t of ['can you make the next one about our $25 cuts', 'do one on our birthday parties', 'post about the holiday hours']) {
      assert.ok(looksLikePostRequest(t), t);
    }
    for (const t of ['shorter', 'less emojis', 'make it punchier']) {
      assert.equal(looksLikePostRequest(t), false, t);
    }
  });

  it('rewrites the next scheduled post around it and shows it again for a yes', async () => {
    const w = concierge({ next: { id: 'p9', mediaRefs: [] } });
    await w.ask('can you make the next one about our $25 cuts');
    assert.equal(w.emitted[0].type, 'REGENERATE_POST');
    assert.equal(w.emitted[0].payload.post_id, 'p9');
    assert.match(String(w.emitted[0].payload.owner_feedback), /\$25 cuts/);
    assert.deepEqual(w.postUpdates[0], { status: 'pending_approval', approvalState: 'awaiting_owner' });
    assert.deepEqual(w.shown, ['Reworked your next post around that ✳ p9']);
  });

  it('with nothing scheduled, keeps it for the next plan and says so', async () => {
    const w = concierge({ next: null, requests: ['older ask'] });
    await w.ask('do one on our birthday parties');
    assert.deepEqual(w.profileUpdates[0], { postRequests: ['older ask', 'do one on our birthday parties'] });
    assert.match(w.sent[0], /next plan/);
    assert.equal(w.emitted.length, 0);
  });
});

describe('the next plan carries the requests', () => {
  it('gives each request its own slot, in order, and keeps what did not fit', () => {
    const slots = [{ a: 1 }, { a: 2 }] as Array<{ a: number; owner_request?: string }>;
    const r = assignOwnerRequests(slots, ['$25 cuts', 'birthday parties', 'gift cards']);
    assert.deepEqual(r.slots.map((s) => s.owner_request), ['$25 cuts', 'birthday parties']);
    assert.deepEqual(r.left, ['gift cards']);
    assert.match(ownerRequestNote('$25 cuts')!, /asked for this post by text: \$25 cuts/);
    assert.equal(ownerRequestNote(undefined), undefined);
  });

  it('plans the week with them and takes them off the list', async () => {
    const updates: Array<Record<string, unknown>> = [];
    let prompt = '';
    const prisma = {
      brandProfile: {
        findUnique: async () => ({ businessType: 'barbershop', postRequests: ['$25 cuts'], postingFrequency: 3, offers: [], dosAndDonts: [], blackoutTopics: [], brandColors: [], referencePhotoRefs: [] }),
        update: async ({ data }: { data: Record<string, unknown> }) => void updates.push(data),
      },
      customer: { findUnique: async () => ({ archetypeSlug: null, planTier: 'starter' }) },
      playbookArchetype: { findUnique: async () => null },
      connectedAccount: { findMany: async () => [{ platform: 'instagram' }] },
      shotListRequest: { create: async () => ({ id: '00000000-0000-0000-0000-000000000001' }) },
    };
    const llm = {
      completeJson: async (req: { prompt: string }) => {
        prompt = req.prompt;
        return {
          slots: ['2026-11-23', '2026-11-25', '2026-11-27'].map((date) => ({
            date, archetype: 'behind_the_scenes', platform: 'instagram', best_time: '09:00', needs_asset: false,
          })),
        };
      },
    };
    const h = new PlanWeekHandler(prisma as never, llm as never, { planningHint: async () => null } as never);
    const out = await h.handle({ type: 'PLAN_WEEK', task_id: 't', customer_id: 'c1', payload: { week_start: '2026-11-23T00:00:00Z' } } as never);
    const slots = (out.data as { slots: Array<{ owner_request?: string }> }).slots;
    assert.equal(slots[0].owner_request, '$25 cuts');
    assert.equal(slots[1].owner_request, undefined);
    assert.match(prompt, /owner asked for these posts.*\$25 cuts/);
    assert.deepEqual(updates, [{ postRequests: [] }]);
  });
});
