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
function makeWorld(opts?: { ownerUpload?: boolean; replace?: boolean; feedback?: string }) {
  const prompts: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const rendered: SlideSpec[][] = [];
  const stored: string[] = [];

  const prisma = {
    customer: {
      findUnique: async () => ({
        businessName: 'Casa Verde',
        planTier: 'growth',
        aiImagesOptIn: false,
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
      // Four slides persisted from the earlier render → the redo's seed salt.
      count: async () => 4,
      create: async () => ({}),
    },
  };
  const llm = {
    completeJson: async (req: { prompt: string }) => {
      prompts.push(req.prompt);
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
  };
  const storage = {
    put: async (key: string) => void stored.push(key),
    get: async () => null,
  };
  const handler = new GenerateCarouselHandler(
    prisma as never,
    llm as never,
    graphics as never,
    storage as never,
    { configured: false } as never,
    {} as never,
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
  return { handler, task, prompts, updates, rendered, stored };
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

  it('without replace_existing, existing media still skips (unchanged default)', async () => {
    const w = makeWorld({ replace: false });
    const r = await w.handler.handle(w.task);
    assert.equal(r.status, 'done');
    assert.match(r.summary_for_owner, /already has a picture/i);
    assert.equal(w.rendered.length, 0);
  });
});
