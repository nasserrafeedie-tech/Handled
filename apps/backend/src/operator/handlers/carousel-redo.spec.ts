import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GenerateCarouselHandler } from './generate-carousel.handler';
import { stableSeed, type SlideSpec } from '../graphics/slide-templates';

/**
 * The redo path (§ revise): "Redo the carousel" must actually rebuild the
 * deck. The bugs this guards:
 *  - the old owner-media guard read ANY mediaRefs as "already has a picture",
 *    so a post carrying the very deck being redone was skipped;
 *  - a re-render reused the identical seed, so a redo returned the same
 *    surfaces with new words;
 *  - the owner's redo words never reached the slide writer.
 */
function makeWorld(opts?: {
  ownerUpload?: boolean;
  replace?: boolean;
  feedback?: string;
  planTier?: string;
  aiImagesOptIn?: boolean;
  imagesConfigured?: boolean;
  walkPhotos?: Array<{ r2Key: string; subject: string }>;
}) {
  const prompts: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const rendered: SlideSpec[][] = [];
  const stored: string[] = [];

  const prisma = {
    customer: {
      findUnique: async () => ({
        businessName: 'Casa Verde',
        planTier: opts?.planTier ?? 'growth',
        aiImagesOptIn: opts?.aiImagesOptIn ?? false,
        trustLevel: 'approve_all',
      }),
    },
    brandProfile: {
      findUnique: async () => ({
        businessType: 'cafe',
        brandColors: [],
        blackoutTopics: [],
        offers: [],
        dosAndDonts: [],
        voiceTone: null,
        targetCustomer: null,
        businessResearch: null,
        logoRef: null,
        visualStyle: null,
      }),
    },
    post: {
      findUnique: async () => ({
        id: 'p1',
        caption: 'Fresh pan dulce every morning, baked in-house.',
        // The deck being redone — four slides from the previous render.
        mediaRefs: ['c1/old/slide-1.png', 'c1/old/slide-2.png', 'c1/old/slide-3.png', 'c1/old/slide-4.png'],
        archetype: 'educational_tip',
      }),
      count: async () => 7,
      update: async (args: { data: Record<string, unknown> }) => void updates.push(args.data),
    },
    mediaAsset: {
      findFirst: async ({ where }: { where: { source?: string } }) =>
        where.source === 'owner_upload' && opts?.ownerUpload ? { id: 'm-owner' } : null,
      // The walk bank — empty unless a test stocks it.
      findMany: async () =>
        (opts?.walkPhotos ?? []).map((w, i) => ({ id: `walk-${i}`, r2Key: w.r2Key, subject: w.subject })),
      // Four slides persisted from the earlier render → the redo's seed salt.
      count: async () => 4,
      create: async () => ({}),
    },
  };
  const llm = {
    completeJson: async (req: { prompt: string }) => {
      prompts.push(req.prompt);
      // The hero path asks for a photo subject before the slides are written.
      if (!req.prompt.includes('"slides"')) return { subject: 'a latte on a wooden counter' };
      return {
        slides: [
          { kind: 'title', headline: 'Morning pan dulce' },
          { kind: 'body', headline: 'Baked here', body: 'Every tray comes out of our own oven.' },
          { kind: 'cta', headline: 'Come by early', cta_label: 'Come by' },
        ],
      };
    },
  };
  const graphics = {
    renderCarousel: (specs: SlideSpec[]) => {
      rendered.push(specs);
      return specs.map(() => Buffer.from('png'));
    },
    fetchPhoto: async (url: string) => `data:image/jpeg;base64,REAL:${url}`,
  };
  const storage = {
    put: async (key: string) => void stored.push(key),
    get: async () => null,
    publicUrl: (k: string) => `https://cdn.test/${k}`,
  };
  const generateCalls: string[] = [];
  const images = {
    configured: opts?.imagesConfigured ?? false,
    generate: async (prompt: string) => {
      generateCalls.push(prompt);
      return { bytes: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg' };
    },
  };
  const handler = new GenerateCarouselHandler(
    prisma as never,
    llm as never,
    graphics as never,
    storage as never,
    images as never,
    { isPlace: async () => ({ isPlace: false }) } as never,
    { screen: async () => ({ passed: true, reasons: [] }) } as never,
  );
  const task = {
    task_id: 't1',
    customer_id: 'c1',
    type: 'GENERATE_CAROUSEL',
    payload: {
      post_id: 'p1',
      replace_existing: opts?.replace ?? false,
      ...(opts?.feedback ? { owner_feedback: opts.feedback } : {}),
    },
  } as never;
  return { handler, task, prompts, updates, rendered, stored, generateCalls };
}

describe('GENERATE_CAROUSEL redo', () => {
  it('replace_existing rebuilds a deck the post already carries', async () => {
    const w = makeWorld({ replace: true, feedback: 'redo the carousel' });
    const r = await w.handler.handle(w.task);
    assert.equal(r.status, 'done');
    assert.equal(w.rendered.length, 1, 'a new deck was rendered');
    assert.equal(w.updates.length, 1, 'the post was updated');
    const refs = w.updates[0].mediaRefs as string[];
    assert.equal(refs.length, 3, 'new slides replace the old four');
    for (const ref of refs) assert.doesNotMatch(ref, /\/old\//, 'no old slide survives');
  });

  it('the redo seed differs from a first render — same post, different look', async () => {
    const w = makeWorld({ replace: true });
    await w.handler.handle(w.task);
    // First render would be posts(7) + brand offset; the redo adds the four
    // persisted slides from the earlier render.
    const expected = 7 + stableSeed('c1') + 4;
    for (const spec of w.rendered[0]) assert.equal(spec.seed, expected);
  });

  it("the owner's redo words reach the slide writer", async () => {
    const w = makeWorld({ replace: true, feedback: 'less text, lead with the price' });
    await w.handler.handle(w.task);
    assert.match(w.prompts[0], /less text, lead with the price/);
  });

  it('an owner photo still wins — replace_existing never touches it', async () => {
    const w = makeWorld({ replace: true, ownerUpload: true });
    const r = await w.handler.handle(w.task);
    assert.equal(r.status, 'done');
    assert.match(r.summary_for_owner, /already has a picture/i);
    assert.equal(w.rendered.length, 0, 'nothing rendered');
    assert.equal(w.updates.length, 0, 'nothing replaced');
  });

  it('PRO gets generated imagery through the deck, no opt-in — disclosed and held for review', async () => {
    const w = makeWorld({ replace: true, planTier: 'pro', imagesConfigured: true });
    const r = await w.handler.handle(w.task);
    assert.equal(r.status, 'done');
    assert.ok(w.rendered[0][0].photo, 'cover slide carries an image');
    assert.equal(w.rendered[0][0].photoLayout, 'full');
    assert.ok(w.rendered[0][1].photo, 'body slide carries its own image');
    assert.equal(w.rendered[0][1].photoLayout, 'band');
    assert.equal(w.rendered[0][2].photo, undefined, 'the CTA slide stays the designed accent flood');
    assert.equal(w.updates[0].aiGeneratedMedia, true, 'AI imagery is disclosed');
    assert.equal(w.updates[0].approvalState, 'awaiting_owner', 'forced back to owner review');
  });

  it('growth without opt-in still gets a text cover — the pro door is pro only', async () => {
    const w = makeWorld({ replace: true, planTier: 'growth', imagesConfigured: true });
    await w.handler.handle(w.task);
    assert.equal(w.rendered[0][0].photo, undefined, 'no hero without consent');
    assert.equal(w.updates[0].aiGeneratedMedia, undefined, 'nothing to disclose');
  });

  it('REAL walk photos displace generation entirely — no AI disclosure, best subject on the cover', async () => {
    const w = makeWorld({
      replace: true,
      planTier: 'pro',
      imagesConfigured: true,
      walkPhotos: [
        { r2Key: 'c1/walk/hands.jpg', subject: 'hands_at_work' },
        { r2Key: 'c1/walk/tool.jpg', subject: 'tool' },
      ],
    });
    await w.handler.handle(w.task);
    // educational_tip cover prefers the tool; the body slide takes the hands.
    assert.match(String(w.rendered[0][0].photo), /tool\.jpg/, 'cover uses the best-fit real photo');
    assert.equal(w.rendered[0][0].photoLayout, 'full');
    assert.match(String(w.rendered[0][1].photo), /hands\.jpg/, 'body slide uses another real photo');
    assert.equal(w.generateCalls.length, 0, 'nothing generated when real photos cover the deck');
    assert.equal(w.updates[0].aiGeneratedMedia, undefined, 'real photos need no AI disclosure');
  });

  it('walk photos on a GROWTH deck too — owner photos need no tier door', async () => {
    const w = makeWorld({
      replace: true,
      planTier: 'growth',
      imagesConfigured: true,
      walkPhotos: [{ r2Key: 'c1/walk/best.jpg', subject: 'todays_best' }],
    });
    await w.handler.handle(w.task);
    assert.match(String(w.rendered[0][0].photo), /best\.jpg/, 'real photo on the cover');
    assert.equal(w.generateCalls.length, 0, 'growth still never generates without opt-in');
  });

  it('without replace_existing, existing media still skips (unchanged default)', async () => {
    const w = makeWorld({ replace: false });
    const r = await w.handler.handle(w.task);
    assert.equal(r.status, 'done');
    assert.match(r.summary_for_owner, /already has a picture/i);
    assert.equal(w.rendered.length, 0);
  });
});
