import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';
import { openSlot, zonedToUtc } from '../common/time';

/**
 * Found by walking a weekly reel through to its yes: it came up as "Draft:"
 * and its caption, with no way to watch it, so the owner approved a video
 * blind. And its yes put it on tomorrow 9:00, in the same minute as a planned
 * post.
 */

function concierge(post: Record<string, unknown>) {
  const sent: Array<{ body: string; opts: any }> = [];
  const updates: any[] = [];
  const prisma = {
    post: { findFirst: async () => post, update: async (a: any) => void updates.push(a) },
    customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
  };
  const storage = { publicUrl: (k: string) => `https://media.example/${k}` };
  const c = new ConciergeService(prisma as any, ...(Array(10).fill(undefined) as []), storage as any);
  (c as any).notify = async (_id: string, body: string, opts: any) => void sent.push({ body, opts });
  return { c, sent, updates };
}

describe('a reel up for its yes', () => {
  it('comes with its link and says it is a reel', async () => {
    const { c, sent, updates } = concierge({
      id: 'p1',
      caption: 'Kids cuts are $20 on weekdays.',
      mediaRefs: ['cust/abc/animated-reel.mp4'],
      scheduledTime: null,
    });
    assert.equal(await c.presentNextDraft('cust'), true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /^Reel 🎬 Watch it here: https:\/\/media\.example\/cust\/abc\/animated-reel\.mp4/);
    assert.match(sent[0].body, /Kids cuts are \$20 on weekdays\./);
    assert.ok(!sent[0].opts.mediaUrls?.length, 'not sent as an MMS video');
    assert.ok(updates[0].data.presentedAt);
  });

  it('a photo draft is shown as before', async () => {
    const { c, sent } = concierge({ id: 'p2', caption: 'Hi', mediaRefs: ['cust/x/photo.jpg'], scheduledTime: null });
    await c.presentNextDraft('cust');
    assert.match(sent[0].body, /^Draft:/);
    assert.equal(sent[0].opts.mediaUrls.length, 1);
  });
});

describe('an open slot for a post with no time of its own', () => {
  const tz = 'America/Los_Angeles';
  const now = new Date('2026-11-17T08:00:00Z').getTime(); // Nov 17, 00:00 in LA

  it('is tomorrow 9:00 when nothing is near it', () => {
    assert.equal(openSlot([], tz, now).toISOString(), zonedToUtc('2026-11-18', '09:00', tz).toISOString());
  });

  it('steps past a planned post, then to the next day', () => {
    const nine = zonedToUtc('2026-11-18', '09:00', tz);
    assert.equal(openSlot([nine], tz, now).toISOString(), zonedToUtc('2026-11-18', '12:30', tz).toISOString());
    const full = ['09:00', '12:30', '17:00'].map((t) => zonedToUtc('2026-11-18', t, tz));
    assert.equal(openSlot(full, tz, now).toISOString(), zonedToUtc('2026-11-19', '09:00', tz).toISOString());
  });

  it('keeps two hours from any post', () => {
    const tenThirty = zonedToUtc('2026-11-18', '10:45', tz);
    assert.equal(openSlot([tenThirty], tz, now).toISOString(), zonedToUtc('2026-11-18', '17:00', tz).toISOString());
  });
});
