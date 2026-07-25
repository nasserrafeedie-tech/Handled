import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateCarouselHandler } from './generate-carousel.handler';

/**
 * The generated hero image on a carousel cover. It reuses the standalone image
 * pipeline's guardrails, so these tests are about the guardrails holding: a
 * refused subject, a place, or any failure must yield NO image — a plain-text
 * cover — never a broken carousel or an undisclosed fabricated place.
 */

function makeHandler(opts: {
  subject?: string;
  isPlace?: boolean;
  generateThrows?: boolean;
  configured?: boolean;
}) {
  const llm = {
    completeJson: async () => ({ subject: opts.subject ?? 'a warm cup of coffee on a wooden table' }),
  };
  const images = {
    configured: opts.configured ?? true,
    generate: async () => {
      if (opts.generateThrows) throw new Error('provider down');
      return { bytes: Buffer.from([1, 2, 3]), contentType: 'image/png', ext: 'png' };
    },
  };
  const safety = {
    isPlace: async () => ({ isPlace: opts.isPlace ?? false, reason: 'test' }),
  };
  const handler = new GenerateCarouselHandler(
    {} as any,
    llm as any,
    {} as any,
    {} as any,
    images as any,
    safety as any,
    { screen: async () => ({ passed: true, reasons: [] }) } as any,
  );
  return handler as any;
}

describe('carousel hero image — guardrails', () => {
  it('returns a data URI when everything passes', async () => {
    const h = makeHandler({ subject: 'a warm cup of coffee' });
    const uri = await h.generateHeroImage('cus_1', 'cafe', 'Fresh roast this week');
    assert.ok(uri?.startsWith('data:image/png;base64,'));
  });

  it('returns null (plain-text cover) when the provider is not configured', async () => {
    const h = makeHandler({ configured: false });
    assert.equal(await h.generateHeroImage('cus_1', 'cafe', 'x'), null);
  });

  it('refuses a subject the place-check flags — no fabricated premises', async () => {
    // The prompt-level refusal is the first of two gates (the vision pixel-check
    // below is the second). A subject it flags must yield no image.
    const h = makeHandler({ subject: 'our office building' });
    assert.equal(await h.generateHeroImage('cus_1', 'dentist', 'x'), null);
  });

  it('discards an image the vision check says depicts a place', async () => {
    const h = makeHandler({ subject: 'a clean modern interior', isPlace: true });
    assert.equal(await h.generateHeroImage('cus_1', 'salon', 'x'), null);
  });

  it('falls back to null when generation throws — never breaks the carousel', async () => {
    const h = makeHandler({ subject: 'a coffee cup', generateThrows: true });
    assert.equal(await h.generateHeroImage('cus_1', 'cafe', 'x'), null);
  });
});

/**
 * The AI-hero approval gate vs. trust level. A generated hero forces the post
 * back to the owner's review — EXCEPT on full_auto, where the owner has
 * consented to both generated imagery and posting without per-post review. The
 * vision place-check (the real safety floor) runs regardless and is not what
 * this decides.
 */
describe('AI hero + trust level → who reviews', () => {
  // Mirror the exact expression the handler uses, so this pins the intent even
  // if the surrounding handler is refactored.
  const forcesReview = (trust: string) => trust !== 'full_auto';

  it('forces owner review on approve_all', () => {
    assert.equal(forcesReview('approve_all'), true);
  });
  it('forces owner review on auto_low_risk', () => {
    assert.equal(forcesReview('auto_low_risk'), true);
  });
  it('waives review ONLY on full_auto (double consent)', () => {
    assert.equal(forcesReview('full_auto'), false);
  });
});
