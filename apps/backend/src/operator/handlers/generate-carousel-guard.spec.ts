import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GenerateCarouselHandler } from './generate-carousel.handler';

/**
 * Slide copy is a second generation the caption's §8 gate never saw. If the
 * model invents an event/stat or surfaces a blackout topic in a slide, the
 * carousel must fall back to a plain post, not render and attach bad slides.
 */
function makeHandler(opts: {
  slides: { kind: string; headline: string; body?: string }[];
  moderationPassed?: boolean;
  blackoutTopics?: string[];
}) {
  const prisma = {
    customer: { findUnique: async () => ({ businessName: 'X', planTier: 'growth', aiImagesOptIn: false, trustLevel: 'approve_all' }) },
    brandProfile: { findUnique: async () => ({ businessType: 'cafe', brandColors: [], blackoutTopics: opts.blackoutTopics ?? [], offers: [], dosAndDonts: [], voiceTone: null, targetCustomer: null, businessResearch: null }) },
    post: { findUnique: async () => ({ id: 'p1', caption: 'A clean caption about coffee.', mediaRefs: [], archetype: 'educational_tip' }) },
  };
  const llm = { completeJson: async () => ({ slides: opts.slides }) };
  const images = { configured: false };
  const moderation = {
    screen: async () => ({ passed: opts.moderationPassed ?? true, reasons: opts.moderationPassed === false ? ['baseline: "hate"'] : [] }),
  };
  return new GenerateCarouselHandler(
    prisma as never, llm as never, {} as never, {} as never,
    images as never, {} as never, moderation as never,
  );
}

const task = { task_id: 't1', customer_id: 'c1', type: 'GENERATE_CAROUSEL', payload: { post_id: 'p1' } } as never;

describe('GENERATE_CAROUSEL content guard', () => {
  it('falls back to a plain post when a slide invents a dated event', async () => {
    const h = makeHandler({
      slides: [
        { kind: 'title', headline: 'Our best roast yet' },
        { kind: 'body', headline: 'Fresh', body: 'We roasted 40 pounds this morning to get it right.' },
        { kind: 'cta', headline: 'Come try it' },
      ],
    });
    const r = await h.handle(task);
    assert.equal(r.status, 'failed');
    assert.match(r.error?.code ?? '', /carousel_content_flagged/);
  });

  it('falls back when moderation blocks a slide', async () => {
    const h = makeHandler({
      slides: [
        { kind: 'title', headline: 'Clean title' },
        { kind: 'body', headline: 'Body', body: 'Ordinary slide text.' },
        { kind: 'cta', headline: 'Visit us' },
      ],
      moderationPassed: false,
    });
    const r = await h.handle(task);
    assert.equal(r.status, 'failed');
    assert.match(r.error?.code ?? '', /carousel_content_flagged/);
  });
});
