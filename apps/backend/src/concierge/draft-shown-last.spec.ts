import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';
import { reelReadyText } from '../operator/handlers/reel-ready';

/**
 * "yes" answers the draft shown last. A carousel asked for during onboarding
 * used to wait behind eight drafts, because "yes" always took the oldest
 * (QA, Nov 17).
 */
type Row = Record<string, unknown>;

function world(shown: boolean) {
  const emitted: Array<{ type: string; payload: Row }> = [];
  const now = Date.now();
  const post = (id: string) => ({
    id,
    customerId: 'c1',
    status: 'pending_approval',
    caption: id === 'p-asked' ? 'The carousel they asked for.' : 'An older draft.',
    mediaRefs: [],
    scheduledTime: new Date(now + 72 * 3_600_000),
    presentedAt: new Date(),
  });
  const lastOutbound = `Draft for Thu 9:00 AM:\n\n“${shown ? 'The carousel they asked for.' : 'An older draft.'}”\n\nReply “yes” to schedule it, or tell me what to change.`;
  const prisma = {
    post: {
      findFirst: async (a: any) => (a.where.presentedAt ? (shown ? post('p-asked') : null) : post('p-oldest')),
      findMany: async () => [],
      findUnique: async () => post(shown ? 'p-asked' : 'p-oldest'),
      update: async () => ({}),
    },
    customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
    conversation: { findUnique: async () => ({ id: 'conv1', pendingIntent: null }), update: async () => ({}) },
    message: {
      create: async () => ({}),
      findFirst: async () => ({ body: lastOutbound }),
      findMany: async () => [{ body: lastOutbound, createdAt: new Date() }],
    },
    mediaAsset: { findFirst: async () => null },
  };
  const bus = {
    emit: async (t: { type: string; payload: Row }) => {
      emitted.push({ type: t.type, payload: t.payload });
      return { summary_for_owner: 'Scheduled.', status: 'done', data: null, error: null };
    },
  };
  const svc = new ConciergeService(
    prisma as never,
    bus as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { classify: async () => ({ intent: 'approve', confidence: 1 }) } as never,
    { completeJson: async () => ({ when: 'none', scope: 'post' }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { publicUrl: (k: string) => `https://cdn.test/${k}` } as never,
  );
  (svc as any).notify = async () => undefined;
  (svc as any).reply = async () => undefined;
  (svc as any).presentNextDraft = async () => false;
  const run = () => (svc as any).handleSteadyState('c1', '+1555', 'conv1', 'yes');
  return { run, emitted };
}

describe('which draft "yes" answers', () => {
  it('the one shown last, when one was shown', async () => {
    const w = world(true);
    await w.run();
    const sched = w.emitted.find((e) => e.type === 'SCHEDULE_POST');
    assert.equal(sched?.payload.post_id, 'p-asked');
  });

  it('the oldest, when none has been shown', async () => {
    const w = world(false);
    await w.run();
    const sched = w.emitted.find((e) => e.type === 'SCHEDULE_POST');
    assert.equal(sched?.payload.post_id, 'p-oldest');
  });
});

describe('the reel-ready text', () => {
  it('a reel the owner asked for takes the yes, and says the others come after', () => {
    const t = reelReadyText('promo reel', 'https://cdn/x.mp4', 2, true);
    assert.match(t, /Reply “yes” to schedule it/);
    assert.match(t, /Your other 2 drafts are still waiting, and I'll bring them back after\./);
  });
  it('a weekly reel waits its turn', () => {
    const t = reelReadyText('promo reel', 'https://cdn/x.mp4', 2);
    assert.doesNotMatch(t, /Reply “yes”/);
    assert.match(t, /right after the 2 drafts/);
  });
});
