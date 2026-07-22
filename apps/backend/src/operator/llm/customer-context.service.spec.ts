import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CustomerContextService, OWN_MIN_SAMPLES } from './customer-context.service';

/** In-memory stand-in for the preference table + posts, applying the same
 *  filters the real queries use. */
function fakePrisma(opts: { prefs?: any[]; posts?: any[] } = {}) {
  const prefs: any[] = (opts.prefs ?? []).map((p, i) => ({
    id: p.id ?? `p${i}`,
    active: true,
    timesSeen: 1,
    kind: 'rule',
    updatedAt: new Date(2026, 0, i + 1),
    ...p,
  }));
  return {
    prefs,
    customerPreference: {
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = prefs.filter(
          (p) => p.customerId === where.customerId && (where.active ? p.active : true),
        );
        if (Array.isArray(orderBy)) {
          rows = [...rows].sort(
            (a, b) => b.timesSeen - a.timesSeen || +b.updatedAt - +a.updatedAt,
          );
        }
        return take ? rows.slice(0, take) : rows;
      },
      create: async ({ data }: any) => {
        prefs.push({ id: `p${prefs.length}`, active: true, timesSeen: 1, updatedAt: new Date(), ...data });
      },
      update: async ({ where, data }: any) => {
        const row = prefs.find((p) => p.id === where.id);
        Object.assign(row, data);
      },
    },
    post: { findMany: async () => opts.posts ?? [] },
  };
}

/** A stub LLM that returns whatever preferences we hand it. */
function fakeLlm(toExtract: { text: string; kind?: string }[]) {
  return {
    completeJson: async () => ({
      preferences: toExtract.map((p) => ({ text: p.text, kind: p.kind ?? 'rule' })),
    }),
  };
}

const svc = (prisma: any, llm: any = fakeLlm([])) =>
  new CustomerContextService(prisma as any, llm as any);

const metric = (impressions: number, eng: number) => ({
  impressions,
  likes: eng,
  comments: 0,
  shares: 0,
  saves: 0,
  fetchedAt: new Date(),
});
const post = (archetype: string, impressions: number, eng: number) => ({
  archetype,
  metrics: [metric(impressions, eng)],
});

describe('learnFromFeedback — the over-learning guard', () => {
  it('stores a standing preference the extractor returns', async () => {
    const prisma = fakePrisma();
    await svc(prisma, fakeLlm([{ text: 'Keep captions short' }])).learnFromFeedback('c1', 'I like them short');
    assert.equal(prisma.prefs.length, 1);
    assert.equal(prisma.prefs[0].text, 'Keep captions short');
  });

  it('stores nothing when the extractor finds only a one-off edit', async () => {
    // "make this one shorter" must not become "always short".
    const prisma = fakePrisma();
    await svc(prisma, fakeLlm([])).learnFromFeedback('c1', 'make this one shorter');
    assert.equal(prisma.prefs.length, 0);
  });

  it('ignores trivially short feedback without calling the model', async () => {
    const prisma = fakePrisma();
    let called = false;
    const llm = { completeJson: async () => { called = true; return { preferences: [] }; } };
    await svc(prisma, llm).learnFromFeedback('c1', 'ok');
    assert.equal(called, false);
    assert.equal(prisma.prefs.length, 0);
  });

  it('reinforces rather than duplicates when the same thing is said again', async () => {
    const prisma = fakePrisma({ prefs: [{ customerId: 'c1', text: 'Keep captions short.', timesSeen: 1 }] });
    // Different wording, same meaning after normalization.
    await svc(prisma, fakeLlm([{ text: 'keep them short' }])).learnFromFeedback('c1', 'still too long');
    assert.equal(prisma.prefs.length, 1, 'should merge, not add a second row');
    assert.equal(prisma.prefs[0].timesSeen, 2, 'count should go up');
  });

  it('never lets a failed extraction throw into the caller', async () => {
    const prisma = fakePrisma();
    const llm = { completeJson: async () => { throw new Error('model down'); } };
    await assert.doesNotReject(svc(prisma, llm).learnFromFeedback('c1', 'I dislike bright colours'));
    assert.equal(prisma.prefs.length, 0);
  });
});

describe('preferences', () => {
  it('returns the strongest first', async () => {
    const prisma = fakePrisma({
      prefs: [
        { customerId: 'c1', text: 'weak', timesSeen: 1 },
        { customerId: 'c1', text: 'strong', timesSeen: 5 },
      ],
    });
    const out = await svc(prisma).preferences('c1');
    assert.equal(out[0].text, 'strong');
  });

  it('keeps one shop\'s preferences out of another\'s', async () => {
    const prisma = fakePrisma({
      prefs: [
        { customerId: 'c1', text: 'theirs' },
        { customerId: 'c2', text: 'someone else' },
      ],
    });
    const out = await svc(prisma).preferences('c1');
    assert.equal(out.length, 1);
    assert.equal(out[0].text, 'theirs');
  });
});

describe('ownPerformanceHint — their numbers, not the trade average', () => {
  const enough = (arch: string, imp: number, eng: number) =>
    Array.from({ length: OWN_MIN_SAMPLES }, () => post(arch, imp, eng));

  it('ranks this shop\'s own formats by engagement', async () => {
    const prisma = fakePrisma({
      posts: [...enough('promo', 1000, 10), ...enough('behind_the_scenes', 1000, 90)],
    });
    const hint = await svc(prisma).ownPerformanceHint('c1');
    assert.match(hint ?? '', /behind_the_scenes 9\.0%/);
    assert.match(hint ?? '', /their posts, not the/);
  });

  it('says nothing until the shop has enough of its own history', async () => {
    // A brand-new shop must fall back to the shared playbook, not a lucky post.
    const prisma = fakePrisma({
      posts: Array.from({ length: OWN_MIN_SAMPLES - 1 }, () => post('promo', 1000, 500)),
    });
    assert.equal(await svc(prisma).ownPerformanceHint('c1'), null);
  });

  it('ignores posts with no impressions yet', async () => {
    const prisma = fakePrisma({
      posts: [...Array.from({ length: OWN_MIN_SAMPLES }, () => post('promo', 800, 40)), post('promo', 0, 0)],
    });
    const hint = await svc(prisma).ownPerformanceHint('c1');
    assert.match(hint ?? '', /over 4 of their own posts/);
  });
});

describe('contextBlock', () => {
  it('is empty when nothing has been learned', async () => {
    assert.equal(await svc(fakePrisma()).contextBlock('c1'), '');
  });

  it('flags a once-mentioned preference so the model weights it lightly', async () => {
    const prisma = fakePrisma({ prefs: [{ customerId: 'c1', text: 'Avoid bright colours', timesSeen: 1 }] });
    const block = await svc(prisma).contextBlock('c1');
    assert.match(block, /Avoid bright colours \(mentioned once — weigh lightly\)/);
  });

  it('states a confirmed preference plainly', async () => {
    const prisma = fakePrisma({ prefs: [{ customerId: 'c1', text: 'Keep captions short', timesSeen: 3 }] });
    const block = await svc(prisma).contextBlock('c1');
    assert.match(block, /- Keep captions short$/m);
    assert.ok(!/weigh lightly/.test(block));
  });

  it('combines preferences and their own performance', async () => {
    const prisma = fakePrisma({
      prefs: [{ customerId: 'c1', text: 'Tag the roaster', timesSeen: 2 }],
      posts: Array.from({ length: OWN_MIN_SAMPLES }, () => post('behind_the_scenes', 1000, 80)),
    });
    const block = await svc(prisma).contextBlock('c1');
    assert.match(block, /Tag the roaster/);
    assert.match(block, /behind_the_scenes/);
  });
});
