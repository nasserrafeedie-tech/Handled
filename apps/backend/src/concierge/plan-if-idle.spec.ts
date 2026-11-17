import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';

/**
 * QA round 4 (Nov 17): back after START or a new checkout with every post
 * already out, the owner was told "I'll plan your next posts and send them
 * over for a look", and nothing came until the Monday run, up to a week
 * later. planIfIdle plans the week right then.
 */
function world(o: { status?: string; lined?: number; drafted?: number }) {
  const shown: string[] = [];
  let planned = 0;
  const prisma = {
    customer: { findUnique: async () => ({ status: o.status ?? 'active' }) },
    post: { count: async () => o.lined ?? 0 },
  };
  const svc = new ConciergeService(prisma as never, {} as never, ...(Array(10).fill({}) as [never]));
  (svc as any).draftFirstWeek = async () => {
    planned++;
    return o.drafted ?? 3;
  };
  (svc as any).presentNextDraft = async (_id: string, lead: string, opts: { promptedByOwner?: boolean }) => {
    shown.push(`${lead} ${opts.promptedByOwner}`);
    return true;
  };
  return { svc, shown, planned: () => planned };
}

describe('planning when someone comes back to nothing', () => {
  it('plans the week and shows the first draft', async () => {
    const w = world({});
    assert.equal(await w.svc.planIfIdle('c1'), true);
    assert.equal(w.planned(), 1);
    assert.deepEqual(w.shown, ["Here's the first one ✳ true"]);
  });

  it('holds the draft for quiet hours when the owner did not just text', async () => {
    const w = world({});
    await w.svc.planIfIdle('c1', { promptedByOwner: false });
    assert.deepEqual(w.shown, ["Here's the first one ✳ false"]);
  });

  it('leaves it alone when posts are already lined up or they are not live', async () => {
    for (const o of [{ lined: 2 }, { status: 'paused' }, { status: 'onboarding' }]) {
      const w = world(o);
      assert.equal(await w.svc.planIfIdle('c1'), false);
      assert.equal(w.planned(), 0);
    }
  });

  it('says nothing when no draft came out of it', async () => {
    const w = world({ drafted: 0 });
    assert.equal(await w.svc.planIfIdle('c1'), false);
    assert.deepEqual(w.shown, []);
  });
});
