import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ArchetypePerformanceService,
  MIN_SAMPLES,
} from './archetype-performance.service';

interface FakePost {
  id: string;
  playbookSlug: string;
  archetype: string;
  platform: string;
  metrics: {
    impressions: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }[];
}

type Row = {
  id: string;
  archetypeSlug: string;
  postArchetype: string;
  platform: string;
  samples: number;
  impressions: bigint;
  engagements: bigint;
};

function fakePrisma(posts: FakePost[], seed: Row[] = []) {
  const table: Row[] = [...seed];
  return {
    table,
    post: { findMany: async () => posts },
    archetypePerformance: {
      upsert: async ({ where, create, update }: any) => {
        const k = where.archetypeSlug_postArchetype_platform;
        const found = table.find(
          (r) =>
            r.archetypeSlug === k.archetypeSlug &&
            r.postArchetype === k.postArchetype &&
            r.platform === k.platform,
        );
        if (found) Object.assign(found, update);
        else table.push({ id: `r${table.length}`, ...create });
      },
      findMany: async ({ where }: any = {}) => {
        if (!where) return table;
        return table.filter(
          (r) =>
            (where.archetypeSlug === undefined || r.archetypeSlug === where.archetypeSlug) &&
            (where.platform === undefined || r.platform === where.platform) &&
            (where.samples?.gte === undefined || r.samples >= where.samples.gte),
        );
      },
      deleteMany: async ({ where }: any) => {
        const ids = new Set(where.id.in as string[]);
        for (let i = table.length - 1; i >= 0; i--) if (ids.has(table[i].id)) table.splice(i, 1);
        return { count: ids.size };
      },
    },
  };
}

const post = (
  archetype: string,
  impressions: number,
  engagements: number,
  slug = 'coffee-shop',
  platform = 'instagram',
): FakePost => ({
  id: `p${Math.random()}`,
  playbookSlug: slug,
  archetype,
  platform,
  metrics: [
    { impressions, likes: engagements, comments: 0, shares: 0, saves: 0 },
  ],
});

const svcFor = (posts: FakePost[], seed: Row[] = []) => {
  const prisma = fakePrisma(posts, seed);
  return { svc: new ArchetypePerformanceService(prisma as any), prisma };
};

describe('recompute', () => {
  it('pools posts of the same format into one row', async () => {
    const { svc, prisma } = svcFor([
      post('promo', 1000, 50),
      post('promo', 1000, 30),
    ]);
    const r = await svc.recompute();
    assert.equal(r.rows, 1);
    assert.equal(prisma.table[0].samples, 2);
    assert.equal(prisma.table[0].impressions, 2000n);
    assert.equal(prisma.table[0].engagements, 80n);
  });

  it('keeps formats, platforms, and archetypes apart', async () => {
    const { svc, prisma } = svcFor([
      post('promo', 100, 5),
      post('behind_the_scenes', 100, 5),
      post('promo', 100, 5, 'coffee-shop', 'facebook'),
      post('promo', 100, 5, 'nail-salon'),
    ]);
    await svc.recompute();
    assert.equal(prisma.table.length, 4);
  });

  it('counts every kind of engagement, not just likes', async () => {
    const { svc, prisma } = svcFor([
      {
        id: 'p1',
        playbookSlug: 'coffee-shop',
        archetype: 'promo',
        platform: 'instagram',
        metrics: [{ impressions: 100, likes: 1, comments: 2, shares: 3, saves: 4 }],
      },
    ]);
    await svc.recompute();
    assert.equal(prisma.table[0].engagements, 10n);
  });

  it('ignores a post with no impressions yet', async () => {
    // Counting it would drag every rate toward zero as a post ages in.
    const { svc, prisma } = svcFor([post('promo', 1000, 50), post('promo', 0, 0)]);
    await svc.recompute();
    assert.equal(prisma.table[0].samples, 1);
  });

  it('uses only the freshest metric reading for a post', async () => {
    // The handler orders desc and takes 1, so the fake mirrors that shape.
    const { svc, prisma } = svcFor([
      {
        id: 'p1',
        playbookSlug: 'coffee-shop',
        archetype: 'promo',
        platform: 'instagram',
        metrics: [{ impressions: 900, likes: 90, comments: 0, shares: 0, saves: 0 }],
      },
    ]);
    await svc.recompute();
    assert.equal(prisma.table[0].impressions, 900n);
  });

  it('replaces totals rather than adding to them', async () => {
    // Metrics get refetched, so a second run over the same posts must not
    // double the numbers.
    const posts = [post('promo', 1000, 50)];
    const { svc, prisma } = svcFor(posts);
    await svc.recompute();
    await svc.recompute();
    assert.equal(prisma.table[0].samples, 1);
    assert.equal(prisma.table[0].impressions, 1000n);
  });

  it('prunes a row whose posts have all gone', async () => {
    const stale: Row = {
      id: 'old',
      archetypeSlug: 'coffee-shop',
      postArchetype: 'seasonal',
      platform: 'instagram',
      samples: 9,
      impressions: 900n,
      engagements: 90n,
    };
    const { svc, prisma } = svcFor([post('promo', 100, 5)], [stale]);
    await svc.recompute();
    assert.ok(!prisma.table.some((r) => r.id === 'old'), 'stale row should be pruned');
  });
});

describe('ranking', () => {
  const enough = (archetype: string, impressions: number, engagements: number) =>
    Array.from({ length: MIN_SAMPLES }, () => post(archetype, impressions, engagements));

  it('orders formats by engagement rate', async () => {
    const { svc } = svcFor([
      ...enough('promo', 1000, 10), // 1%
      ...enough('behind_the_scenes', 1000, 80), // 8%
    ]);
    await svc.recompute();
    const ranked = await svc.ranking('coffee-shop');
    assert.equal(ranked[0].postArchetype, 'behind_the_scenes');
    assert.ok(Math.abs(ranked[0].rate - 0.08) < 1e-9);
  });

  it('withholds a format that has too few posts behind it', async () => {
    // One lucky post must not rewrite the strategy for everyone.
    const { svc } = svcFor(
      Array.from({ length: MIN_SAMPLES - 1 }, () => post('promo', 100, 90)),
    );
    await svc.recompute();
    assert.deepEqual(await svc.ranking('coffee-shop'), []);
  });

  it('includes a format the moment it has enough', async () => {
    const { svc } = svcFor(enough('promo', 100, 9));
    await svc.recompute();
    assert.equal((await svc.ranking('coffee-shop')).length, 1);
  });

  it('filters by platform when asked', async () => {
    const { svc } = svcFor([
      ...enough('promo', 100, 5),
      ...Array.from({ length: MIN_SAMPLES }, () =>
        post('promo', 100, 5, 'coffee-shop', 'facebook'),
      ),
    ]);
    await svc.recompute();
    assert.equal((await svc.ranking('coffee-shop', 'facebook')).length, 1);
    assert.equal((await svc.ranking('coffee-shop')).length, 2);
  });

  it('returns nothing for an archetype nobody has posted for', async () => {
    const { svc } = svcFor([]);
    await svc.recompute();
    assert.deepEqual(await svc.ranking('brand-new-thing'), []);
  });
});

describe('planningHint', () => {
  it('is null with no evidence, so the caller can tell the difference', async () => {
    // "No evidence yet" must never read as "nothing works".
    const { svc } = svcFor([]);
    await svc.recompute();
    assert.equal(await svc.planningHint('coffee-shop'), null);
  });

  it('states the rate and the sample size together', async () => {
    const { svc } = svcFor(
      Array.from({ length: 6 }, () => post('behind_the_scenes', 1000, 40)),
    );
    await svc.recompute();
    const hint = await svc.planningHint('coffee-shop');
    assert.match(hint ?? '', /behind_the_scenes 4\.0% engagement over 6 posts/);
  });

  it('tells the planner to keep the week varied', async () => {
    // Otherwise the best-performing format eats every slot.
    const { svc } = svcFor(Array.from({ length: 6 }, () => post('promo', 100, 5)));
    await svc.recompute();
    assert.match(await svc.planningHint('coffee-shop') ?? '', /varied/);
  });
});
