import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { SchedulePostHandler } from './schedule-post.handler';

/**
 * SCHEDULE_POST must never rewind a terminal post back to 'scheduled', and must
 * never schedule (or resurrect) a post the owner rejected. Both were holes: the
 * old approval check treated 'rejected' as "not awaiting_owner → approved", and
 * there was no status guard at all.
 */
function build(post: Record<string, unknown> | null) {
  const scheduled: unknown[] = [];
  const updates: unknown[] = [];
  const prisma = {
    post: {
      findFirst: async () => post,
      update: async (args: unknown) => {
        updates.push(args);
        return {};
      },
    },
    customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
  };
  const queue = { schedule: async (d: unknown, w: Date) => scheduled.push({ d, w }) };
  const handler = new SchedulePostHandler(prisma as never, queue as never);
  return { handler, scheduled, updates };
}

const task = (owner_approved = false) =>
  ({
    task_id: 't1',
    customer_id: 'c1',
    type: 'SCHEDULE_POST',
    payload: { post_id: 'p1', scheduled_time: '2026-08-01T17:00:00Z', owner_approved },
  }) as never;

const base = {
  id: 'p1',
  status: 'approved',
  approvalState: 'approved',
  moderationState: 'passed',
};

describe('SCHEDULE_POST guards', () => {
  it('schedules a clean approved post', async () => {
    const { handler, scheduled } = build({ ...base });
    const r = await handler.handle(task());
    assert.equal(r.status, 'done');
    assert.equal(scheduled.length, 1);
  });

  it('refuses a rejected post even with owner_approved:true (no resurrection)', async () => {
    const { handler, scheduled, updates } = build({
      ...base,
      status: 'cancelled',
      approvalState: 'rejected',
    });
    const r = await handler.handle(task(true));
    assert.equal(r.status, 'failed');
    assert.equal(scheduled.length, 0, 'a rejected post is never queued');
    assert.equal(updates.length, 0, 'and never rewritten to approved/scheduled');
  });

  it('refuses a terminal-status post (published/failed) — no rewind to scheduled', async () => {
    for (const status of ['published', 'publishing', 'cancelled', 'failed']) {
      const { handler, scheduled } = build({ ...base, status, approvalState: 'approved' });
      const r = await handler.handle(task());
      assert.equal(r.status, 'failed', status);
      assert.equal(scheduled.length, 0, status);
    }
  });

  it('still honors a fresh owner yes on an awaiting_owner post', async () => {
    const { handler, scheduled } = build({
      ...base,
      status: 'pending_approval',
      approvalState: 'awaiting_owner',
    });
    const r = await handler.handle(task(true));
    assert.equal(r.status, 'done');
    assert.equal(scheduled.length, 1);
  });

  it('refuses an awaiting_owner post with no owner yes', async () => {
    const { handler, scheduled } = build({
      ...base,
      status: 'pending_approval',
      approvalState: 'awaiting_owner',
    });
    const r = await handler.handle(task(false));
    assert.equal(r.status, 'failed');
    assert.equal(scheduled.length, 0);
  });
});
