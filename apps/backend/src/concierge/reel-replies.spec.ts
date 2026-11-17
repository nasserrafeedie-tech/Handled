import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { reelName, reelLookText, plainReelText, REVEAL_NEEDS_TWO } from './reel-replies';

describe('reel replies', () => {
  it('names the reel by kind', () => {
    assert.equal(reelName('promo', 'c/x/animated-reel.mp4'), 'promo reel');
    assert.equal(reelName('behind_the_scenes', 'c/x/animated-reel.mp4'), 'before and after reel');
    assert.equal(reelName('promo', 'c/x/reel.mp4'), 'reel');
  });

  it('shows the link, invites a yes while it waits, and says where it stands', () => {
    const base = { what: 'promo reel', url: 'https://cdn/x.mp4', when: null };
    const waiting = reelLookText({ ...base, status: 'pending_approval' });
    assert.match(waiting, /https:\/\/cdn\/x\.mp4/);
    assert.match(waiting, /Reply “yes”/);
    assert.match(reelLookText({ ...base, status: 'scheduled', when: 'Fri 2:00 PM' }), /scheduled for Fri 2:00 PM/);
    assert.match(reelLookText({ ...base, status: 'published' }), /already posted/);
  });

  it('a plain reel ask gets the clip link, the no-footage kinds, or the upgrade', () => {
    const v = { uploadUrl: 'https://site/upload?c=1', upgrade: 'Pro is $699 a month.' };
    assert.match(plainReelText({ ...v, pro: false, animated: true }), /^Reels are part of Pro\./);
    const pro = plainReelText({ ...v, pro: true, animated: true });
    assert.match(pro, /upload\?c=1/);
    assert.match(pro, /make a promo reel/);
    assert.match(pro, /before and after reel/);
    assert.doesNotMatch(plainReelText({ ...v, pro: true, animated: false }), /promo/);
  });

  it('a reveal with the wrong number of photos asks for both together', () => {
    assert.match(REVEAL_NEEDS_TWO, /two photos in one text/);
  });
});

describe('"show me the reel" in the concierge', () => {
  async function look(video: unknown) {
    const { ConciergeService } = await import('./concierge.service');
    const sent: string[] = [];
    const presented: string[] = [];
    const prisma = {
      mediaAsset: { findFirst: async () => video },
      post: { update: async (a: any) => void presented.push(a.where.id) },
      customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
    };
    const storage = { publicUrl: (k: string) => `https://cdn.example/${k}` };
    const rest = Array(9).fill({});
    const svc = new ConciergeService(prisma as never, {} as never, ...(rest as [never]), storage as never);
    (svc as any).reply = async (_to: string, _c: string, body: string) => void sent.push(body);
    const shown = await (svc as any).showLatestReel('c1', '+1555', 'conv1');
    return { shown, sent, presented };
  }

  it('sends the newest reel again, and a waiting one takes the next yes', async () => {
    const r = await look({
      r2Key: 'c1/x/animated-reel.mp4',
      post: { id: 'p1', status: 'pending_approval', archetype: 'promo', scheduledTime: null, createdAt: new Date() },
    });
    assert.equal(r.shown, true);
    assert.match(r.sent[0], /Here's your promo reel 🎬 https:\/\/cdn\.example\/c1\/x\/animated-reel\.mp4/);
    assert.match(r.sent[0], /Reply “yes”/);
    assert.deepEqual(r.presented, ['p1']);
  });

  it('with no reel yet, or a cancelled one, leaves the text to the usual handling', async () => {
    assert.equal((await look(null)).shown, false);
    const cancelled = await look({ r2Key: 'k.mp4', post: { id: 'p1', status: 'cancelled', archetype: null, scheduledTime: null, createdAt: new Date() } });
    assert.equal(cancelled.shown, false);
    assert.equal(cancelled.sent.length, 0);
  });
});

describe('a bare yes when the last text was not the draft', () => {
  it('shows the draft that yes would schedule instead of only saying it waits', async () => {
    const { ConciergeService } = await import('./concierge.service');
    const svc = new ConciergeService({} as never, {} as never, ...(Array(10).fill({}) as [never]));
    const shown: Array<{ lead: string; postId?: string }> = [];
    const sent: string[] = [];
    (svc as any).presentNextDraft = async (_c: string, lead: string, o: { postId?: string }) => {
      shown.push({ lead, postId: o.postId });
      return true;
    };
    (svc as any).reply = async (_to: string, _c: string, body: string) => void sent.push(body);
    await (svc as any).yesOffTheDraft('c1', '+1555', 'conv1', { id: 'p7', scheduledTime: null });
    assert.deepEqual(shown, [{ lead: 'Here’s the draft that’s up first ✳', postId: 'p7' }]);
    assert.equal(sent.length, 0);
  });
});
