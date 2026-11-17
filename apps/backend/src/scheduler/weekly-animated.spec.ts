import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { reelNotice, weekNumber, weeklyPromoOffer } from './weekly-animated';
import { CronService } from './cron.service';
import { reelJobId } from './queue.constants';

describe('weekly animated promo: which offer', () => {
  it('turns through the priced offers a week at a time', () => {
    const offers = ['Walk-ins welcome', 'Kids cuts $20 on weekdays', 'Beard trim 15% off', 'Free hot towel with any shave'];
    const picks = [0, 1, 2, 3].map((w) => weeklyPromoOffer(offers, w));
    assert.deepEqual(picks, [
      'Kids cuts $20 on weekdays',
      'Beard trim 15% off',
      'Free hot towel with any shave',
      'Kids cuts $20 on weekdays',
    ]);
  });

  it('uses any offer when none is priced, and none when there are none', () => {
    assert.equal(weeklyPromoOffer(['Walk-ins welcome'], 7), 'Walk-ins welcome');
    assert.equal(weeklyPromoOffer([], 3), null);
    assert.equal(weeklyPromoOffer(['  '], 3), null);
    assert.equal(weeklyPromoOffer(undefined, 3), null);
  });

  it('counts weeks from Monday', () => {
    const mon = weekNumber(new Date('2026-11-16T08:00:00Z'));
    assert.equal(weekNumber(new Date('2026-11-22T23:00:00Z')), mon);
    assert.equal(weekNumber(new Date('2026-11-23T00:30:00Z')), mon + 1);
  });

  it('has its own job slot, so it never replaces a reel the owner asked for', () => {
    assert.notEqual(reelJobId('c1', true, true), reelJobId('c1', true));
    assert.notEqual(reelJobId('c1', true, true), reelJobId('c1'));
  });
});

describe('weekly animated promo: what the owner hears', () => {
  const ready = (ahead: number) => ({ status: 'pending_approval' as const, summary_for_owner: 'Your promo reel is ready', data: { waiting_ahead: ahead } });

  it('answers a reel the owner asked for, whatever happened', () => {
    assert.deepEqual(reelNotice({}, ready(2)), { text: 'Your promo reel is ready', promptedByOwner: true });
    assert.deepEqual(reelNotice({}, { status: 'failed', summary_for_owner: 'snag', data: null }), { text: 'snag', promptedByOwner: true });
  });

  it('keeps a weekly reel quiet behind other drafts, and quiet when it fails', () => {
    assert.equal(reelNotice({ weekly: true }, ready(3)), null);
    assert.equal(reelNotice({ weekly: true }, { status: 'failed', summary_for_owner: 'snag', data: null }), null);
  });

  it('shows a weekly reel when nothing else is waiting', () => {
    assert.deepEqual(reelNotice({ weekly: true }, ready(0)), { text: 'Your promo reel is ready', promptedByOwner: false });
  });
});

describe('weekly animated promo: the Monday step', () => {
  const was = process.env.ANIMATED_REELS;
  afterEach(() => {
    if (was === undefined) delete process.env.ANIMATED_REELS;
    else process.env.ANIMATED_REELS = was;
  });

  function cron(opts: { offers?: string[]; recent?: number; queue?: boolean } = {}) {
    const queued: any[] = [];
    const prisma = {
      brandProfile: { findUnique: async () => ({ offers: opts.offers ?? ['Kids cuts $20 on weekdays'] }) },
      mediaAsset: { count: async () => opts.recent ?? 0 },
    };
    const queue = { enqueue: async (d: any) => void queued.push(d) };
    const c = new CronService(
      prisma as any,
      ...(Array(9).fill(undefined) as []),
      ...((opts.queue === false ? [undefined] : [queue]) as []),
    );
    return { c, queued };
  }

  it('queues one quiet promo for Pro from the owner offer', async () => {
    process.env.ANIMATED_REELS = '1';
    const { c, queued } = cron();
    assert.equal(await c.queueWeeklyAnimatedPromo('c1', 'pro'), true);
    assert.deepEqual(queued, [
      { customerId: 'c1', platform: 'instagram', weekly: true, animated: { kind: 'promo', offerText: 'Kids cuts $20 on weekdays' } },
    ]);
  });

  it('does nothing when off, below Pro, with no offers, or made this week', async () => {
    delete process.env.ANIMATED_REELS;
    assert.equal(await cron().c.queueWeeklyAnimatedPromo('c1', 'pro'), false);
    process.env.ANIMATED_REELS = '1';
    assert.equal(await cron().c.queueWeeklyAnimatedPromo('c1', 'growth'), false);
    assert.equal(await cron({ offers: [] }).c.queueWeeklyAnimatedPromo('c1', 'pro'), false);
    assert.equal(await cron({ recent: 1 }).c.queueWeeklyAnimatedPromo('c1', 'pro'), false);
    assert.equal(await cron({ queue: false }).c.queueWeeklyAnimatedPromo('c1', 'pro'), false);
  });
});
