import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CronService } from './cron.service';

/**
 * Auto-approved posts must reach the publish queue.
 *
 * The bug: on an autopilot plan a cleared post is persisted status='approved',
 * but the publish sweep and the reconciler only look at status='scheduled'. So
 * an auto-approved post sat 'approved' forever — never published, never even
 * marked failed. The weekly rhythm must dispatch SCHEDULE_POST for it, exactly
 * as the owner-approval path does when the owner texts yes.
 */

interface EmitCall {
  type: string;
  payload: any;
}

function makeCron(postStatus: string) {
  const emitted: EmitCall[] = [];
  const slot = {
    platform: 'instagram',
    archetype: 'promo',
    date: '2026-07-27',
    best_time: '10:00',
    needs_asset: false,
    shot_list: null,
  };
  const bus = {
    emit: async (task: any) => {
      emitted.push({ type: task.type, payload: task.payload });
      switch (task.type) {
        case 'PLAN_WEEK':
          return { data: { slots: [slot] } };
        case 'DRAFT_POST':
          return {
            data: { post_id: 'post_1', needs_carousel: false, needs_image: false },
          };
        default:
          return { status: 'done', data: {} };
      }
    },
  };
  const prisma = {
    customer: {
      findUnique: async () => ({ timezone: 'America/Los_Angeles', planTier: 'starter' }),
    },
    post: {
      // The post as persisted by DRAFT_POST — 'approved' on autopilot,
      // 'pending_approval' on an approval plan.
      findUnique: async () => ({ status: postStatus }),
    },
    // A stocked photo bank, so the photo-walk nudge stays quiet here.
    mediaAsset: { count: async () => 3 },
  };
  const concierge = { presentNextDraft: async () => true, notify: async () => {} };

  const cron = new CronService(
    prisma as any,
    bus as any,
    concierge as any,
    ...(Array(5).fill(undefined) as []),
  );
  return { cron, emitted };
}

describe('runWeeklyRhythm — scheduling auto-approved posts', () => {
  it('dispatches SCHEDULE_POST for a post cleared for autopilot', async () => {
    const { cron, emitted } = makeCron('approved');
    await cron.runWeeklyRhythm('cus_1');

    const sched = emitted.find((e) => e.type === 'SCHEDULE_POST');
    assert.ok(sched, 'an auto-approved post must be scheduled, not left stranded');
    assert.equal(sched!.payload.post_id, 'post_1');
    assert.equal(sched!.payload.owner_approved, false, 'system-approved, not owner');
    assert.ok(sched!.payload.scheduled_time, 'must carry a scheduled time');
  });

  it('does NOT schedule a post still awaiting the owner', async () => {
    const { cron, emitted } = makeCron('pending_approval');
    await cron.runWeeklyRhythm('cus_1');

    assert.equal(
      emitted.some((e) => e.type === 'SCHEDULE_POST'),
      false,
      'an approval-plan post must wait for the owner, not auto-schedule',
    );
  });
});
