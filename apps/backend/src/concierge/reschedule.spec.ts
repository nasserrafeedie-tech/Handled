import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';
import { IntentService } from './intent.service';

/**
 * Timing is an instruction, not decoration (live failure, Aug 7): "Post it
 * right now" got scheduled for Monday 8:30, and "shift the schedule to start
 * today" was swallowed as a plain approve. An approval carries its own time
 * when it names one, and reschedule is a first-class intent.
 */

type Row = Record<string, unknown>;

function makeWorld(opts: {
  intent: 'approve' | 'reschedule';
  body: string;
  parse?: { when: string; scope?: 'post' | 'week' };
  pending?: boolean;
  upcoming?: Array<{ id: string; status: string; hoursFromNow: number }>;
}) {
  const emitted: Array<{ type: string; payload: Row }> = [];
  const replied: string[] = [];
  const updates: Array<{ id: string; data: Row }> = [];
  const now = Date.now();

  const pendingPost = opts.pending
    ? {
        id: 'p-pending',
        customerId: 'cust1',
        status: 'pending_approval',
        caption: 'A caption.',
        mediaRefs: [],
        scheduledTime: new Date(now + 3 * 86_400_000),
        presentedAt: new Date(),
      }
    : null;
  const upcoming = (opts.upcoming ?? []).map((u) => ({
    id: u.id,
    status: u.status,
    scheduledTime: new Date(now + u.hoursFromNow * 3_600_000),
  }));

  const prisma = {
    post: {
      findFirst: async () => pendingPost,
      // The real query matches pending_approval too — the pending draft is
      // part of "upcoming" exactly as it would be in Postgres.
      findMany: async () =>
        [...(pendingPost ? [pendingPost] : []), ...upcoming].sort(
          (a, b) => (a.scheduledTime as Date).getTime() - (b.scheduledTime as Date).getTime(),
        ),
      findUnique: async () => pendingPost ?? upcoming[0] ?? null,
      update: async (args: { where: { id: string }; data: Row }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
    customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
    conversation: { findUnique: async () => ({ id: 'conv1', pendingIntent: null }), update: async () => ({}) },
    message: { create: async () => ({}) },
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
    { classify: async () => ({ intent: opts.intent, feedback: opts.body, confidence: 1 }) } as never,
    {
      completeJson: async () =>
        opts.parse ? { when: opts.parse.when, scope: opts.parse.scope ?? 'post' } : { when: 'none', scope: 'post' },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { publicUrl: (k: string) => `https://cdn.test/${k}` } as never,
  );
  (svc as unknown as Row).notify = async () => undefined;
  (svc as unknown as Row).reply = async (_p: string, _c: string, b: string) => void replied.push(b);
  (svc as unknown as Row).presentNextDraft = async () => false;

  const run = () =>
    (svc as unknown as {
      handleSteadyState(id: string, phone: string, conv: string, body: string): Promise<void>;
    }).handleSteadyState('cust1', '+15550001111', 'conv1', opts.body);
  return { run, emitted, replied, updates, now };
}

describe('timing in approvals and reschedules', () => {
  it('"Post it right now" schedules NOW, not the planned slot', async () => {
    const w = makeWorld({
      intent: 'approve',
      body: 'Post it right now',
      parse: { when: 'now' },
      pending: true,
    });
    await w.run();
    const sched = w.emitted.find((e) => e.type === 'SCHEDULE_POST');
    assert.ok(sched, 'SCHEDULE_POST dispatched');
    const when = new Date(sched!.payload.scheduled_time as string).getTime();
    assert.ok(Math.abs(when - w.now) < 5 * 60_000, `scheduled ~now, got ${sched!.payload.scheduled_time}`);
  });

  it('a plain "yes" keeps the planned slot — no parse, no drift', async () => {
    const w = makeWorld({ intent: 'approve', body: 'yes', pending: true });
    await w.run();
    const sched = w.emitted.find((e) => e.type === 'SCHEDULE_POST');
    const when = new Date(sched!.payload.scheduled_time as string).getTime();
    assert.ok(Math.abs(when - (w.now + 3 * 86_400_000)) < 60_000, 'planned time kept');
  });

  it('"shift the schedule to start today" moves the whole week, day-shifted', async () => {
    const w = makeWorld({
      intent: 'reschedule',
      body: 'Shift the schedule to start today and post it now',
      parse: { when: 'now', scope: 'week' },
      upcoming: [
        { id: 'a', status: 'scheduled', hoursFromNow: 72 },
        { id: 'b', status: 'approved', hoursFromNow: 100 },
        { id: 'c', status: 'pending_approval', hoursFromNow: 124 },
      ],
    });
    await w.run();
    const scheds = w.emitted.filter((e) => e.type === 'SCHEDULE_POST');
    assert.equal(scheds.length, 2, 'scheduled + approved posts re-enter the queue');
    assert.equal(w.updates.length, 1, 'the pending draft just carries its new time');
    assert.equal(w.updates[0].id, 'c');
    const first = new Date(scheds[0].payload.scheduled_time as string).getTime();
    assert.ok(first < w.now + 30 * 3_600_000, 'the first post moved up by days');
    assert.match(w.replied[0], /Shifted 3 posts/);
  });

  it('"move it to Friday" on a pending draft retimes WITHOUT approving', async () => {
    const w = makeWorld({
      intent: 'reschedule',
      body: 'move it to friday morning',
      parse: { when: '2026-08-14 09:00' },
      pending: true,
    });
    await w.run();
    assert.equal(w.emitted.filter((e) => e.type === 'SCHEDULE_POST').length, 0, 'no approval implied');
    assert.equal(w.updates[0]?.id, 'p-pending');
    assert.match(w.replied[0], /Moved it to[\s\S]*reply "yes"/);
  });

  it('timing the parser cannot read asks instead of guessing', async () => {
    const w = makeWorld({ intent: 'reschedule', body: 'change the timing', pending: true });
    await w.run();
    assert.equal(w.emitted.length, 0);
    assert.match(w.replied[0], /Tell me when/);
  });
});

describe('reschedule keyword routing (offline classifier)', () => {
  const offline = (text: string) =>
    (new IntentService(undefined as never) as unknown as {
      classifyOffline(t: string): { intent: string };
    }).classifyOffline(text);

  it('timing phrases route to reschedule, not revise or approve', () => {
    for (const t of [
      'Shift the schedule to start today so mondays post is today and post it now',
      'move it to friday',
      'change the schedule',
      'post it right now',
      'push it back a day',
    ]) {
      assert.equal(offline(t).intent, 'reschedule', `"${t}"`);
    }
  });

  it('plain approvals and revisions keep their lanes', () => {
    assert.equal(offline('yes looks great').intent, 'approve');
    assert.equal(offline('make it shorter').intent, 'revise');
  });
});
