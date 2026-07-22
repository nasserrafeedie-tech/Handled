import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { hasStorefront, reelClipsFor } from './vertical-playbook';

/**
 * Every reel recipe opens by asking for a shot of the business's premises. Our
 * own account exposed the hole: Handled has no building, so the weekly ask was
 * "film your storefront from outside" — an instruction that cannot be followed,
 * which stalls the whole reel rather than costing one clip. The playbook already
 * carries mobile trades with the same problem.
 */
const CLIPS = [
  'your storefront or space from outside',
  'the most visual moment of the work you do',
  'a happy customer moment or the finished result',
] as const;

describe('hasStorefront', () => {
  it('is true for the places customers walk into', () => {
    for (const t of ['coffee shop', 'hair salon', 'barbershop', 'dental practice', 'bakery', 'gym']) {
      assert.equal(hasStorefront(t), true, `${t} has premises`);
    }
  });

  it('is false for businesses with nowhere to visit', () => {
    for (const t of [
      'social media service for local businesses',
      'marketing agency',
      'freelance consultant',
      'online store',
    ]) {
      assert.equal(hasStorefront(t), false, `${t} has no premises`);
    }
  });

  it('is false for trades that travel to the customer', () => {
    // All three are already archetypes in the playbook.
    for (const t of ['mobile locksmith', 'moving and hauling company', 'residential cleaning service']) {
      assert.equal(hasStorefront(t), false, `${t} goes to the customer`);
    }
  });
});

describe('reelClipsFor', () => {
  it('leaves the recipe alone for a business with premises', () => {
    assert.deepEqual(reelClipsFor('coffee shop', CLIPS), [...CLIPS]);
  });

  it('replaces only the storefront clip when there is no storefront', () => {
    const out = reelClipsFor('marketing agency', CLIPS);
    assert.notEqual(out[0], CLIPS[0], 'the unfilmable clip must be swapped');
    assert.ok(!/storefront|space from outside/i.test(out[0]));
    // The work and the result hold for everyone — don't touch them.
    assert.equal(out[1], CLIPS[1]);
    assert.equal(out[2], CLIPS[2]);
  });

  it('always hands back three filmable clips', () => {
    for (const t of ['social media service for local businesses', 'coffee shop', null]) {
      const out = reelClipsFor(t, CLIPS);
      assert.equal(out.length, 3);
      assert.ok(out.every((c) => typeof c === 'string' && c.length > 8));
    }
  });
});
