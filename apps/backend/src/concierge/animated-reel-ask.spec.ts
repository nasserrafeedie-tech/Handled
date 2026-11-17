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
