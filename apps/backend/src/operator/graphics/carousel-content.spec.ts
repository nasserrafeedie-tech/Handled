import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  CarouselLlmOutput,
  carouselInstruction,
  isCarouselArchetype,
  tierHasCarousel,
} from './carousel-content';

describe('tierHasCarousel — a Growth+ headline feature', () => {
  it('includes the real paid tiers', () => {
    for (const t of ['growth', 'pro']) {
      assert.equal(tierHasCarousel(t), true, `${t} should have carousels`);
    }
  });

  it('excludes Starter — the reason to move up', () => {
    assert.equal(tierHasCarousel('starter'), false);
  });

  it('excludes any tier that is not a real plan (fail closed)', () => {
    // "premium" was never sellable; an unknown tier must not silently unlock
    // features the concierge would then tell the customer they do not have.
    for (const t of ['premium', 'enterprise', '', 'GROWTH']) {
      assert.equal(tierHasCarousel(t), false, `${t} must not have carousels`);
    }
  });
});

describe('isCarouselArchetype — carousels are the default for text-forward posts', () => {
  it('turns informational archetypes into carousels', () => {
    for (const a of ['educational_tip', 'product_spotlight', 'promo', 'testimonial', 'seasonal'] as const) {
      assert.equal(isCarouselArchetype(a), true, `${a} should be a carousel`);
    }
  });

  it('leaves the photo-first archetypes to a photo', () => {
    for (const a of ['behind_the_scenes', 'were_open', 'ugc_repost'] as const) {
      assert.equal(isCarouselArchetype(a), false, `${a} should not be a carousel`);
    }
  });
});

describe('carouselInstruction', () => {
  it('grounds the slides in the caption and brand facts, and bans invention', () => {
    const instr = carouselInstruction({
      businessType: 'dental practice',
      archetype: 'product_spotlight',
      caption: 'Whitening takes about an hour and is gentle on enamel.',
      brandName: 'Bright Smile Dental',
    });
    assert.match(instr, /Whitening takes about an hour/);
    assert.match(instr, /Do not[\s\S]*invent statistics/); // honesty rule survives
    assert.match(instr, /NEVER pad/); // no filler slides
    assert.match(instr, /cta_label/); // CTA button is authored, not hardcoded
    assert.match(instr, /product spotlight/); // archetype humanised
    assert.match(instr, /Bright Smile Dental/); // brand name offered for the CTA
  });
});

describe('CarouselLlmOutput schema — what the model is allowed to hand back', () => {
  it('accepts a well-formed title→body→cta carousel', () => {
    const parsed = CarouselLlmOutput.safeParse({
      slides: [
        { kind: 'title', headline: 'Teeth whitening, explained', body: 'What actually happens in the chair.' },
        { kind: 'body', headline: 'One visit', body: 'About an hour, start to finish.' },
        { kind: 'cta', headline: 'Ready when you are', body: 'Book a whitening consult.' },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it('accepts the full 8-10 slide deck the prompt asks for', () => {
    // The live failure this guards: the prompt asked for 6-10 slides while
    // the schema still capped at 6 — the model obeyed the prompt, validation
    // rejected the result, and every deck failed with "couldn't lay that one
    // out as slides". The schema must never cap below the prompt's target.
    const slides = [
      { kind: 'title', headline: 'Ten slides of real material' },
      ...Array.from({ length: 8 }, (_, i) => ({
        kind: 'body',
        headline: `Point ${i + 1}`,
        body: 'One concrete idea, under twenty words.',
      })),
      { kind: 'cta', headline: 'Come see us', cta_label: 'Book now' },
    ];
    assert.equal(CarouselLlmOutput.safeParse({ slides }).success, true);
    assert.equal(
      CarouselLlmOutput.safeParse({ slides: [...slides, slides[1]] }).success,
      false,
      'eleven slides is past the deck cap',
    );
  });

  it('rejects a carousel too short to be worth a swipe', () => {
    const parsed = CarouselLlmOutput.safeParse({
      slides: [{ kind: 'title', headline: 'Hi' }, { kind: 'cta', headline: 'Bye' }],
    });
    assert.equal(parsed.success, false);
  });

  it('rejects an unknown slide kind and stray fields', () => {
    assert.equal(
      CarouselLlmOutput.safeParse({ slides: [{ kind: 'hero', headline: 'x' }, { kind: 'body', headline: 'y' }, { kind: 'cta', headline: 'z' }] }).success,
      false,
    );
    assert.equal(
      CarouselLlmOutput.safeParse({ slides: [{ kind: 'title', headline: 'x', photo: 'data:...' }, { kind: 'body', headline: 'y' }, { kind: 'cta', headline: 'z' }] }).success,
      false,
    );
  });
});
