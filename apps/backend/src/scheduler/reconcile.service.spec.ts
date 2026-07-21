import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ReconcileService } from './reconcile.service';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date('2026-07-21T18:00:00Z');

interface Row {
  id: string;
  customerId: string;
  scheduledTime: Date;
}

/**
 * Applies the same filters the real query does, so the test covers which posts
 * the sweep selects — the part that actually matters — rather than only what
 * it does once it has them.
 */
function fakePrisma(rows: Row[]) {
  const updated: { where: any; data: any }[] = [];
  return {
    updated,
    post: {
      findMany: async ({ where }: any) => {
        const lt = where.scheduledTime.lt as Date;
        const gte = where.scheduledTime.gte as Date;
        return rows.filter((r) => r.scheduledTime < lt && r.scheduledTime >= gte);
      },
      updateMany: async (args: any) => {
        updated.push(args);
        const lt = args.where.scheduledTime.lt as Date;
        return { count: rows.filter((r) => r.scheduledTime < lt).length };
      },
    },
  };
}

function fakeQueue() {
  const scheduled: { postId: string; when: Date }[] = [];
  return {
    scheduled,
    schedule: async (data: { postId: string }, when: Date) => {
      scheduled.push({ postId: data.postId, when });
    },
  };
}

const build = (rows: Row[]) => {
  const prisma = fakePrisma(rows);
  const queue = fakeQueue();
  return { svc: new ReconcileService(prisma as any, queue as any), prisma, queue };
};

const at = (offsetMs: number): Row => ({
  id: `p${offsetMs}`,
  customerId: 'c1',
  scheduledTime: new Date(NOW.getTime() + offsetMs),
});

describe('ReconcileService.sweep', () => {
  it('re-queues a post whose moment passed', () => {
    const { svc, queue } = build([at(-2 * HOUR)]);
    return svc.sweep(NOW).then((r) => {
      assert.equal(r.requeued, 1);
      assert.equal(queue.scheduled.length, 1);
    });
  });

  it('publishes it now, not at the time that already went by', async () => {
    const { svc, queue } = build([at(-2 * HOUR)]);
    await svc.sweep(NOW);
    assert.equal(queue.scheduled[0].when.getTime(), NOW.getTime());
  });

  it('leaves a post that is not due yet alone', async () => {
    const { svc, queue } = build([at(2 * HOUR)]);
    const r = await svc.sweep(NOW);
    assert.equal(r.requeued, 0);
    assert.equal(queue.scheduled.length, 0);
  });

  it('gives a just-due post a grace period rather than racing the queue', async () => {
    // Five minutes late is a job about to fire, not a lost one. Re-queueing
    // here would fight the scheduler instead of backstopping it.
    const { svc, queue } = build([at(-5 * MIN)]);
    assert.equal((await svc.sweep(NOW)).requeued, 0);
    assert.equal(queue.scheduled.length, 0);
  });

  it('picks up a post once it is properly late', async () => {
    assert.equal((await build([at(-30 * MIN)]).svc.sweep(NOW)).requeued, 1);
  });

  it('does not publish something so old it has stopped being true', async () => {
    // A Tuesday lunch special must not appear on Friday.
    const { svc, queue } = build([at(-72 * HOUR)]);
    const r = await svc.sweep(NOW);
    assert.equal(queue.scheduled.length, 0, 'a three-day-old post should not go out');
    assert.ok(r.stale > 0, 'and it should be recorded as missed, not left invisible');
  });

  it('records the write-off with a reason someone can read later', async () => {
    const { svc, prisma } = build([at(-72 * HOUR)]);
    await svc.sweep(NOW);
    assert.equal(prisma.updated[0].data.status, 'failed');
    assert.match(prisma.updated[0].data.failureReason, /stranded/);
  });

  it('only considers posts already cleared to publish', async () => {
    // A draft waiting on the owner is not stranded — it is waiting.
    const { svc } = build([]);
    const prisma = fakePrisma([]);
    let captured: any;
    prisma.post.findMany = async ({ where }: any) => {
      captured = where;
      return [];
    };
    await new ReconcileService(prisma as any, fakeQueue() as any).sweep(NOW);
    assert.deepEqual(captured.approvalState, { not: 'awaiting_owner' });
    assert.equal(captured.moderationState, 'passed');
    assert.equal(captured.status, 'scheduled');
    assert.deepEqual(captured.customer, { status: 'active' });
    void svc;
  });

  it('keeps going when one post cannot be re-queued', async () => {
    const prisma = fakePrisma([at(-2 * HOUR), at(-3 * HOUR)]);
    const queue = fakeQueue();
    const good = queue.schedule;
    queue.schedule = async (data: { postId: string }, when: Date) => {
      if (data.postId === 'p-7200000') throw new Error('redis down');
      return good(data, when);
    };
    const r = await new ReconcileService(prisma as any, queue as any).sweep(NOW);
    assert.equal(r.requeued, 1, 'the healthy post should still be re-queued');
  });

  it('reports nothing when there is nothing to do', async () => {
    const r = await build([]).svc.sweep(NOW);
    assert.deepEqual(r, { requeued: 0, stale: 0 });
  });
});
