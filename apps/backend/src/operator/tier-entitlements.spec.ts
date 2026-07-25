import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tierHas,
  entitlementLine,
  upgradePitch,
  platformLimit,
  canConnectPlatform,
  postsPerWeek,
} from './tier-entitlements';
import { tierHasCarousel } from './graphics/carousel-content';

/**
 * The sales copy and the code gates must agree. The whole point of this module
 * is that a Starter customer is never promised a carousel the engine will then
 * refuse — so the tests pin the promise to the gate, not to a hardcoded string.
 */
describe('tier entitlements', () => {
  it('matches the carousel code gate exactly — no drift', () => {
    for (const tier of ['starter', 'growth', 'pro']) {
      assert.equal(
        tierHas(tier, 'carousel'),
        tierHasCarousel(tier),
        `${tier}: entitlement disagrees with the real gate`,
      );
    }
  });

  it('Starter excludes the paid features', () => {
    assert.equal(tierHas('starter', 'carousel'), false);
    assert.equal(tierHas('starter', 'reel'), false);
    assert.equal(tierHas('starter', 'image'), false);
  });

  it('Growth and Pro include carousels', () => {
    assert.equal(tierHas('growth', 'carousel'), true);
    assert.equal(tierHas('pro', 'carousel'), true);
  });

  it('caps connected platforms at 2 / 4 / all by tier', () => {
    assert.equal(platformLimit('starter'), 2);
    assert.equal(platformLimit('growth'), 4);
    assert.equal(platformLimit('pro'), 5);
    // An unknown tier fails closed to the smallest allowance.
    assert.equal(platformLimit('mystery'), 2);
  });

  describe('canConnectPlatform', () => {
    it('lets a Starter customer connect their two, then blocks a third', () => {
      assert.equal(canConnectPlatform('starter', [], 'instagram'), true);
      assert.equal(canConnectPlatform('starter', ['instagram'], 'google_business'), true);
      assert.equal(
        canConnectPlatform('starter', ['instagram', 'google_business'], 'facebook'),
        false,
      );
    });

    it('always allows reconnecting a platform already on the list', () => {
      // Re-authing an expired token must never be refused for being "full".
      assert.equal(
        canConnectPlatform('starter', ['instagram', 'google_business'], 'instagram'),
        true,
      );
    });

    it('gives Growth four and Pro all five', () => {
      const four = ['instagram', 'facebook', 'tiktok', 'threads'];
      assert.equal(canConnectPlatform('growth', four, 'google_business'), false);
      assert.equal(canConnectPlatform('pro', four, 'google_business'), true);
    });
  });

  it('sells the 3 / 5 / 7 posts-per-week ladder, unknown fails to Starter', () => {
    assert.equal(postsPerWeek('starter'), 3);
    assert.equal(postsPerWeek('growth'), 5);
    assert.equal(postsPerWeek('pro'), 7);
    assert.equal(postsPerWeek('premium'), 3);
    assert.equal(postsPerWeek(''), 3);
  });

  it('reels and video are Pro-exclusive — Growth does not include them', () => {
    // The packaging decision: reels are what a customer climbs to Pro for, so
    // Growth must NOT unlock them or the differentiator collapses.
    assert.equal(tierHas('growth', 'reel'), false);
    assert.equal(tierHas('growth', 'video_upload'), false);
    assert.equal(tierHas('pro', 'reel'), true);
    assert.equal(tierHas('pro', 'video_upload'), true);
  });

  it('an unknown tier is treated as Starter, never as unlocked', () => {
    // A malformed value must fail closed — the safe direction is "no access".
    assert.equal(tierHas('', 'carousel'), false);
    assert.equal(tierHas('enterprise', 'carousel'), false);
  });

  describe('entitlementLine — what the concierge is told', () => {
    it('tells the model NOT to promise a carousel on Starter', () => {
      const line = entitlementLine('starter');
      assert.match(line, /does not include/i);
      assert.match(line, /carousel/i);
      assert.match(line, /do not promise|never claim/i);
    });

    it('names Growth as the tier that unlocks it', () => {
      assert.match(entitlementLine('starter'), /growth/i);
    });

    it('on Pro, says everything is included', () => {
      assert.match(entitlementLine('pro'), /everything/i);
    });
  });

  describe('upgradePitch — leads with the actual reason to upgrade', () => {
    it('sells Starter on carousels, not reels — reels are the Pro story now', () => {
      const pitch = upgradePitch('starter');
      assert.match(pitch, /carousel/i);
      // Reels must NOT be dangled to a Starter customer: they are the
      // Growth→Pro hero, so mentioning them here would sell past Growth.
      assert.doesNotMatch(pitch, /reel/i);
    });

    it('leads the Growth→Pro pitch with reels', () => {
      const pitch = upgradePitch('growth');
      assert.match(pitch, /reel/i);
      assert.match(pitch, /pro/i);
    });

    it('pitches Pro (not carousels) to someone already on Growth', () => {
      const pitch = upgradePitch('growth');
      assert.match(pitch, /pro/i);
      assert.doesNotMatch(pitch, /carousel/i);
    });
  });
});
