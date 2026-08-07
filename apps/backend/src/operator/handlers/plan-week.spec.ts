import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { clampAssetAsks, clampPlatforms, clampPromoQuota, MAX_ASSET_ASKS } from './plan-week.handler';

/**
 * The bug this guards against, measured on a real account: the planner marked
 * all five slots `needs_asset`, so every slot sat waiting on a photo — and a
 * slot waiting on a photo is skipped by BOTH carousel and image generation. The
 * customer got a week of bare text posts and never saw the feature they had
 * upgraded for. Asking is not free; every ask spends a slot.
 */
const slot = (archetype: string, needs_asset = true) => ({ archetype, needs_asset });

describe('clampAssetAsks', () => {
  it('leaves a reasonable week alone', () => {
    const week = [slot('behind_the_scenes'), slot('educational_tip', false), slot('promo', false)];
    assert.deepEqual(clampAssetAsks(week), week);
  });

  it('caps a week that asks for a photo on every slot', () => {
    const week = [
      slot('behind_the_scenes'), slot('educational_tip'), slot('testimonial'),
      slot('product_spotlight'), slot('seasonal'),
    ];
    const out = clampAssetAsks(week);
    assert.equal(out.filter((s) => s.needs_asset).length, MAX_ASSET_ASKS);
  });

  it('spends the asks on posts that have no fallback, not on carousels', () => {
    // were_open and behind_the_scenes have nothing to fall back on; the
    // carousel archetypes can design themselves, so they yield first.
    const week = [
      slot('educational_tip'), slot('behind_the_scenes'), slot('product_spotlight'),
      slot('were_open'), slot('promo'),
    ];
    const kept = clampAssetAsks(week).filter((s) => s.needs_asset).map((s) => s.archetype);
    assert.deepEqual(kept.sort(), ['behind_the_scenes', 'were_open']);
  });

  it('leaves enough of the week free to actually be designed', () => {
    const week = Array.from({ length: 5 }, () => slot('educational_tip'));
    const free = clampAssetAsks(week).filter((s) => !s.needs_asset).length;
    assert.ok(free >= 3, `expected most of the week to be generatable, got ${free}`);
  });

  it('does not invent asks that the planner never made', () => {
    const week = [slot('promo', false), slot('seasonal', false)];
    assert.equal(clampAssetAsks(week).filter((s) => s.needs_asset).length, 0);
  });
});

describe('clampPlatforms', () => {
  const p = (platform: string) => ({ platform });

  it('moves posts off platforms the customer has not connected', () => {
    // The real bug: 3 of 7 posts aimed at facebook/threads when only instagram
    // was connected, so they silently never published.
    const week = [p('instagram'), p('facebook'), p('threads'), p('instagram')];
    const out = clampPlatforms(week, ['instagram']);
    assert.ok(out.every((s) => s.platform === 'instagram'), JSON.stringify(out));
  });

  it('leaves a slot that is already on a connected platform alone', () => {
    const week = [p('facebook'), p('instagram')];
    const out = clampPlatforms(week, ['instagram', 'facebook']);
    assert.deepEqual(out.map((s) => s.platform), ['facebook', 'instagram']);
  });

  it('spreads the moved posts across connected platforms, not all onto one', () => {
    // A customer with two platforms should keep both fed.
    const week = [p('tiktok'), p('tiktok'), p('tiktok'), p('tiktok')];
    const out = clampPlatforms(week, ['instagram', 'facebook']);
    const counts = out.reduce<Record<string, number>>((m, s) => {
      m[s.platform] = (m[s.platform] ?? 0) + 1;
      return m;
    }, {});
    assert.equal(counts.instagram, 2);
    assert.equal(counts.facebook, 2);
  });

  it('leaves slots untouched when nothing is connected yet', () => {
    // Planning still has to run before the owner links an account.
    const week = [p('instagram'), p('facebook')];
    assert.deepEqual(clampPlatforms(week, []), week);
  });

  it('handles google_business like any other connected platform', () => {
    const out = clampPlatforms([p('instagram'), p('tiktok')], ['google_business']);
    assert.ok(out.every((s) => s.platform === 'google_business'));
  });
});

describe('clampPromoQuota — the trust ratio, guaranteed', () => {
  const slot = (archetype: string) => ({ archetype });

  it('a five-slot week keeps at most one promo; extras become saveable tips', () => {
    const out = clampPromoQuota([
      slot('promo'), slot('promo'), slot('promo'),
      slot('behind_the_scenes'), slot('testimonial'),
    ]);
    assert.equal(out.filter((s) => s.archetype === 'promo').length, 1);
    assert.equal(out.filter((s) => s.archetype === 'educational_tip').length, 2);
    assert.equal(out[3].archetype, 'behind_the_scenes', 'non-promo slots untouched');
  });

  it('the FIRST promo survives — position is the planner\'s choice, count is ours', () => {
    const out = clampPromoQuota([slot('educational_tip'), slot('promo'), slot('promo')]);
    assert.equal(out[1].archetype, 'promo');
    assert.equal(out[2].archetype, 'educational_tip');
  });

  it('a week inside the ratio passes through unchanged', () => {
    const week = [slot('promo'), slot('behind_the_scenes'), slot('educational_tip'), slot('testimonial'), slot('were_open')];
    assert.deepEqual(clampPromoQuota(week), week);
  });

  it('a short 3-post week still allows its one promo', () => {
    const out = clampPromoQuota([slot('promo'), slot('educational_tip'), slot('testimonial')]);
    assert.equal(out.filter((s) => s.archetype === 'promo').length, 1);
  });
});
