import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BusinessMetricsService } from './business-metrics.service';

/**
 * Classifying a post's treatment. Each post gets ONE label, the most-branded
 * winning — a post with an assembled slide is a carousel even if it also has a
 * banked photo. Getting this wrong would quietly mis-report the mix the founder
 * tunes from, so it is pinned.
 */
function makeService(postMedia: { source: string }[][], asks = { requested: 0, fulfilled: 0 }) {
  const prisma = {
    post: {
      findMany: async () => postMedia.map((media) => ({ media })),
    },
    shotListRequest: {
      count: async ({ where }: any) =>
        where.status === 'requested' ? asks.requested : asks.fulfilled,
    },
  };
  return new BusinessMetricsService(prisma as any);
}

describe('media mix classification', () => {
  it('counts one post per treatment, most-branded wins', async () => {
    const svc = makeService([
      [{ source: 'assembled' }, { source: 'assembled' }], // carousel (multi-slide)
      [{ source: 'assembled' }, { source: 'owner_upload' }], // carousel wins over photo
      [{ source: 'ai_generated' }], // ai image
      [{ source: 'owner_upload' }], // owner photo
      [], // text only
      [], // text only
    ]);
    const mix = await svc.mediaMix();
    assert.equal(mix.totalPosts, 6);
    assert.equal(mix.carousel, 2);
    assert.equal(mix.aiImage, 1);
    assert.equal(mix.ownerPhoto, 1);
    assert.equal(mix.textOnly, 2);
  });

  it('reports photo asks separately from produced posts', async () => {
    const svc = makeService([[]], { requested: 3, fulfilled: 5 });
    const mix = await svc.mediaMix();
    assert.deepEqual(mix.photoAsks, { pending: 3, fulfilled: 5 });
  });

  it('is all zeros with no posts, not a divide-by-zero', async () => {
    const svc = makeService([]);
    const mix = await svc.mediaMix();
    assert.equal(mix.totalPosts, 0);
    assert.equal(mix.carousel + mix.aiImage + mix.ownerPhoto + mix.textOnly, 0);
  });
});
