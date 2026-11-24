import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ensureVisual } from './visual-safety-net';

describe('carousel safety net', () => {
  const run = async (o: { media: string[] | null; needsAsset?: boolean; planTier?: string }) => {
    const made: string[] = [];
    const did = await ensureVisual(
      { findMedia: async () => (o.media ? { mediaRefs: o.media } : null), makeCarousel: async (id) => void made.push(id) },
      { id: 'p1', needsAsset: o.needsAsset ?? false, planTier: o.planTier ?? 'growth' },
    );
    return { did, made };
  };

  it('makes a carousel for a bare post on a carousel plan', async () => {
    assert.deepEqual(await run({ media: [] }), { did: true, made: ['p1'] });
  });

  it('leaves alone a post with media, one waiting on a photo, and Starter', async () => {
    assert.equal((await run({ media: ['a.png'] })).did, false);
    assert.equal((await run({ media: [], needsAsset: true })).did, false);
    assert.equal((await run({ media: [], planTier: 'starter' })).did, false);
    assert.equal((await run({ media: null })).did, false);
  });
});
