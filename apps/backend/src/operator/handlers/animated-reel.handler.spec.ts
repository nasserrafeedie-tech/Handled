import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { AnimatedReelHandler } from './animated-reel.handler';

/**
 * ANIMATED_REEL: dark unless the flag is on, Pro only, never invents the
 * offer, and lands as a draft for the owner's yes like every other post.
 */
function build(opts: { planTier?: string; offers?: string[]; photos?: boolean; waiting?: number } = {}) {
  const created: { post?: any; assets: any[]; stored: string[]; renders: any[] } = { assets: [], stored: [], renders: [] };
  const prisma = {
    customer: {
      findUnique: async () => ({ id: 'c1', planTier: opts.planTier ?? 'pro', businessName: 'Sharp & Co', trustLevel: 'new' }),
    },
    brandProfile: {
      findUnique: async () => ({
        customerId: 'c1',
        offers: opts.offers ?? ['Fade + beard $35, usually $45'],
        brandColors: ['#111111', '#C9A227'],
        visualStyle: 'bold',
        businessType: 'barber shop',
        websiteUrl: 'sharpandco.com',
        blackoutTopics: [],
        dosAndDonts: [],
        voiceTone: 'friendly',
      }),
    },
    post: {
      count: async (a: any) => (a.where.status ? (opts.waiting ?? 0) : 3),
      create: async (a: any) => (created.post = { id: 'p1', ...a.data }),
      update: async (a: any) => Object.assign(created.post, a.data),
    },
    mediaAsset: {
      findFirst: async (a: any) => (opts.photos ? { id: `m-${a.where.subject}`, r2Key: `k/${a.where.subject}.jpg` } : null),
      findMany: async () => [],
      updateMany: async () => ({}),
      create: async (a: any) => created.assets.push(a.data),
    },
  };
  const animated = {
    preparePhoto: async () => 'data:image/jpeg;base64,xx',
    render: async (layout: any, look: any, o: any) => {
      created.renders.push({ layout, look, o });
      return { mp4: Buffer.from('mp4'), stats: {} };
    },
  };
  const llm = {
    completeJson: async () => {
      throw new Error('LLM output was not valid JSON');
    },
  };
  const moderation = { screen: async () => ({ passed: true }) };
  const gate = { classifyRisk: () => 'low', decide: () => ({ approvalState: 'awaiting_owner' }) };
  const storage = {
    put: async (k: string) => created.stored.push(k),
    get: async () => Buffer.from('jpg'),
    publicUrl: (k: string) => `https://cdn.example/${k}`,
  };
  const handler = new AnimatedReelHandler(
    prisma as never,
    animated as never,
    llm as never,
    moderation as never,
    gate as never,
    storage as never,
  );
  return { handler, created };
}

const task = (payload: Record<string, unknown>) =>
  ({ task_id: 't1', customer_id: 'c1', type: 'ANIMATED_REEL', payload: { platform: 'instagram', ...payload } }) as never;

describe('ANIMATED_REEL', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ANIMATED_REELS;
    process.env.ANIMATED_REELS = '1';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ANIMATED_REELS;
    else process.env.ANIMATED_REELS = saved;
  });

  it('does nothing while the flag is off', async () => {
    delete process.env.ANIMATED_REELS;
    const { handler, created } = build();
    const r = await handler.handle(task({ kind: 'promo' }));
    assert.equal(r.error?.code, 'feature_off');
    assert.equal(created.renders.length, 0);
  });

  it('is Pro only', async () => {
    const { handler, created } = build({ planTier: 'growth' });
    const r = await handler.handle(task({ kind: 'promo' }));
    assert.equal(r.error?.code, 'plan_gate');
    assert.match(r.summary_for_owner, /Pro/);
    assert.equal(created.renders.length, 0);
  });

  it('asks for the offer rather than making one up', async () => {
    const { handler } = build({ offers: [] });
    const r = await handler.handle(task({ kind: 'promo' }));
    assert.equal(r.error?.code, 'no_offer');
  });

  it('makes a promo from the profile offer and stages it for a yes', async () => {
    const { handler, created } = build();
    const r = await handler.handle(task({ kind: 'promo' }));
    assert.equal(r.status, 'pending_approval');
    assert.match(r.summary_for_owner, /promo reel is ready/);
    assert.match(r.summary_for_owner, /Reply “yes”/);
    assert.equal(created.renders[0].layout.kind, 'promo');
    assert.equal(created.renders[0].layout.price.lines[0], '$35');
    assert.equal(created.post.archetype, 'promo');
    assert.equal(created.post.status, 'pending_approval');
    // The model was unavailable, so the words are the owner's own.
    assert.equal((r.data as any).copy_source, 'offline');
    assert.match(created.post.caption, /\$35/);
    assert.equal(created.assets[0].kind, 'video');
    assert.match(created.stored[0], /^c1\/.+\/animated-reel\.mp4$/);
  });

  it('says where it sits when older drafts are still waiting', async () => {
    const { handler, created } = build({ waiting: 2 });
    const r = await handler.handle(task({ kind: 'promo' }));
    assert.doesNotMatch(r.summary_for_owner, /Reply “yes”/);
    assert.match(r.summary_for_owner, /right after the 2 drafts already waiting on you/);
    assert.equal(created.post.presentedAt, undefined);
  });

  it('counts as shown when nothing is ahead of it', async () => {
    const { handler, created } = build();
    await handler.handle(task({ kind: 'promo' }));
    assert.ok(created.post.presentedAt instanceof Date);
  });

  it('a reveal needs a before and an after photo', async () => {
    const none = await build().handler.handle(task({ kind: 'before_after' }));
    assert.equal(none.error?.code, 'not_enough_photos');
    const { handler, created } = build({ photos: true });
    const r = await handler.handle(task({ kind: 'before_after' }));
    assert.equal(r.status, 'pending_approval');
    assert.ok(created.renders[0].o.photos.before && created.renders[0].o.photos.after);
    assert.equal(created.post.archetype, 'behind_the_scenes');
  });
});
