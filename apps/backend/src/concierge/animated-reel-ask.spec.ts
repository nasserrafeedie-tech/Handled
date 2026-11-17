import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';

/**
 * Texting "make a promo reel for ..." queues an animated reel on the worker
 * for a Pro customer, and gets the upgrade pitch on any other plan.
 */
function concierge(withQueue: boolean) {
  const sent: string[] = [];
  const queued: any[] = [];
  const emitted: any[] = [];
  const bus = {
    emit: async (t: any) => {
      emitted.push(t);
      return { summary_for_owner: 'Your promo reel is ready' };
    },
  };
  const queue = { enqueue: async (d: any) => void queued.push(d) };
  const svc = new ConciergeService(
    {} as never,
    bus as never,
    ...(Array(10).fill({}) as [never]),
    (withQueue ? queue : undefined) as never,
  );
  (svc as any).reply = async (_to: string, _c: string, body: string) => void sent.push(body);
  const ask = (tier: string, kind: 'promo' | 'before_after', offerText?: string) =>
    (svc as any).requestAnimatedReel('c1', tier, '+1555', 'conv1', { kind, offerText });
  return { ask, sent, queued, emitted };
}

describe('asking for an animated reel by text', () => {
  it('queues it on the worker for Pro and says it is on the way', async () => {
    const w = concierge(true);
    await w.ask('pro', 'promo', 'kids cuts $20 on weekdays');
    assert.deepEqual(w.queued[0], {
      customerId: 'c1',
      platform: 'instagram',
      animated: { kind: 'promo', offerText: 'kids cuts $20 on weekdays' },
    });
    assert.match(w.sent[0], /promo reel will be here/);
    assert.equal(w.emitted.length, 0);
  });

  it('pitches Pro to anyone else and makes nothing', async () => {
    const w = concierge(true);
    await w.ask('growth', 'before_after');
    assert.equal(w.queued.length, 0);
    assert.match(w.sent[0], /part of Pro/);
  });

  it('renders in-process when there is no queue', async () => {
    const w = concierge(false);
    await w.ask('pro', 'promo');
    assert.equal(w.emitted[0].type, 'ANIMATED_REEL');
    assert.deepEqual(w.emitted[0].payload, { kind: 'promo', platform: 'instagram' });
    assert.equal(w.sent[0], 'Your promo reel is ready');
  });
});

describe('words sent with two photos', () => {
  it('"before and after reel" alone counts once the photos are attached', async () => {
    const { isRevealCaption } = await import('./animated-reel-ask');
    assert.equal(isRevealCaption('before and after reel'), true);
    assert.equal(isRevealCaption('Before & after video please'), true);
    assert.equal(isRevealCaption('show me the before and after reel'), false);
    assert.equal(isRevealCaption('before and after'), false);
    assert.equal(isRevealCaption('new photos for the week'), false);
  });
});

describe('asking to see a reel, or for a reel with no kind', () => {
  it('reads a look at a reel they already have', async () => {
    const { isReelLook } = await import('./animated-reel-ask');
    for (const t of ['show me the reel', "where's the video", 'can I see the reel again', 'send me the reel', 'resend the video']) {
      assert.equal(isReelLook(t), true, t);
    }
    for (const t of ["I'll send you the video tomorrow", 'make a reel', 'send the video to my sister?', 'see you tomorrow']) {
      assert.equal(isReelLook(t), false, t);
    }
  });

  it('reads a reel ask that names no kind', async () => {
    const { isPlainReelAsk } = await import('./animated-reel-ask');
    for (const t of ['make a reel', 'can you do a video for us', 'I want a reel this week']) {
      assert.equal(isPlainReelAsk(t), true, t);
    }
    for (const t of ['make a promo reel for kids cuts $20', 'do a before and after reel', 'show me the reel', 'make a carousel']) {
      assert.equal(isPlainReelAsk(t), false, t);
    }
  });
});
