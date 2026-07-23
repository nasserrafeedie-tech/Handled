import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  renderSlideSvg,
  stableSeed,
  type BrandTheme,
  type SlideSpec,
} from './slide-templates';

const theme: BrandTheme = {
  primary: '#0E5C63',
  secondary: '#E8A13A',
  brandName: 'Bright Smile Dental',
  style: 'modern',
};

/**
 * The surface is entirely described by the <defs> block (its gradient stops) —
 * so two slides share a look exactly when their defs match. The decorative
 * shapes live after </defs>, which lets us assert "same surface, different
 * decoration" precisely.
 */
function surfaceOf(svg: string): string {
  const m = /<defs>[\s\S]*?<\/defs>/.exec(svg);
  assert.ok(m, 'every slide should declare a surface in <defs>');
  return m[0];
}
function decorationOf(svg: string): string {
  return svg.slice(svg.indexOf('</defs>'));
}

const slide = (over: Partial<SlideSpec> = {}): SlideSpec => ({
  kind: 'body',
  headline: 'Gentle on your enamel',
  body: 'We check first and stop if anything feels sensitive.',
  ...over,
});

/** One carousel = one seed, slides 0..n. */
const carousel = (seed: number, n = 5) =>
  Array.from({ length: n }, (_, i) =>
    renderSlideSvg(slide({ seed, variant: i }), theme));

describe('a carousel is one post, so its slides look like a set', () => {
  it('gives every slide in the set the same surface', () => {
    const svgs = carousel(3);
    const surfaces = new Set(svgs.map(surfaceOf));
    assert.equal(surfaces.size, 1, 'all slides in a carousel share one surface');
  });

  it('still varies the decoration slide to slide, so it is not five identical cards', () => {
    const decos = carousel(3).map(decorationOf);
    assert.ok(new Set(decos).size > 1, 'the shapes behind the words should change');
  });
});

describe('variety lives between posts, not inside one', () => {
  it('gives different posts different surfaces', () => {
    // Walk a full rotation: consecutive seeds must not repeat a surface.
    const seen = Array.from({ length: 7 }, (_, s) =>
      surfaceOf(renderSlideSvg(slide({ seed: s, variant: 0 }), theme)));
    assert.equal(new Set(seen).size, 7, 'each seed in the rotation is a distinct surface');
  });

  it('two carousels running back to back do not look alike', () => {
    assert.notEqual(surfaceOf(carousel(4)[0]), surfaceOf(carousel(5)[0]));
  });
});

describe('rendering is deterministic', () => {
  it('re-rendering the same slide is byte-identical — a re-run must not reshuffle the art', () => {
    const a = renderSlideSvg(slide({ seed: 2, variant: 1 }), theme);
    const b = renderSlideSvg(slide({ seed: 2, variant: 1 }), theme);
    assert.equal(a, b);
  });

  it('falls back to variant when no set seed is given (one-off graphics)', () => {
    const svg = renderSlideSvg(slide({ variant: 2 }), theme);
    assert.equal(surfaceOf(svg), surfaceOf(renderSlideSvg(slide({ seed: 2, variant: 2 }), theme)));
  });
});

describe('the words always survive the layout', () => {
  it('shrinks a long headline to fit instead of truncating it', () => {
    const long = 'Your dentist keeps mentioning floss for a reason.';
    const svg = renderSlideSvg(slide({ kind: 'title', headline: long, seed: 0 }), theme);
    const text = (svg.match(/<tspan[^>]*>([^<]*)<\/tspan>/g) ?? [])
      .map((t) => t.replace(/<[^>]*>/g, ''))
      .join(' ');
    assert.ok(text.includes('reason'), 'the last word must not be dropped');
    assert.ok(!svg.includes('…'), 'no ellipsis — the type should shrink, not the copy');
  });
});

/**
 * The fingerprint an owner caught: seeding only off the post count meant two
 * DIFFERENT businesses got the identical design at the same post number — open
 * one feed, recognise it in another. The handler now mixes in a stable per-brand
 * offset (stableSeed(customerId)); these prove it actually spreads businesses
 * across the design space instead of marching them in lockstep.
 */
describe('two different businesses should not share a look', () => {
  // Simulate distinct customer ids the way the handlers seed: made + offset.
  const ids = Array.from({ length: 24 }, (_, i) => `cus_${i}_a1b2c3d4e5f6`);

  it('stableSeed is deterministic and differs across ids', () => {
    for (const id of ids) assert.equal(stableSeed(id), stableSeed(id));
    const distinct = new Set(ids.map(stableSeed));
    assert.ok(distinct.size >= ids.length - 1, 'offsets must be well spread');
  });

  it('at the SAME post number, brands land on a spread of surfaces', () => {
    const made = 3; // every brand posting its 4th carousel
    const surfaces = new Set(
      ids.map((id) =>
        surfaceOf(renderSlideSvg(slide({ seed: made + stableSeed(id), variant: 0 }), theme))),
    );
    // Post-count-only seeding put ALL of them on one surface (size 1). With the
    // brand offset they cover most of the rotation. Not a guarantee of no
    // collision, but no longer a guarantee of one.
    assert.ok(surfaces.size >= 4, `expected a spread of surfaces, got ${surfaces.size}`);
  });

  it('the same brand still gets feed variety across its own posts', () => {
    const id = ids[0];
    const surfaces = new Set(
      [0, 1, 2, 3, 4, 5, 6].map((made) =>
        surfaceOf(renderSlideSvg(slide({ seed: made + stableSeed(id), variant: 0 }), theme))),
    );
    assert.ok(surfaces.size >= 5, 'a brand walking its own post counts still varies');
  });
});
