import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { detectFabrication } from './fabrication';

/**
 * Every "invents" case below is real output from the live drafter, written for a
 * business with zero customers, against a prompt that forbids exactly this in
 * capital letters. The "allows" cases are what it is supposed to write instead.
 */
describe('detectFabrication', () => {
  it('catches the testimonial that started this', () => {
    const caption =
      'A salon owner in South Bay told us last week: "I don\'t have time to sit ' +
      'around thinking about Instagram." So we handle it. She gets new regulars ' +
      'every month who saw her work online.';
    const found = detectFabrication(caption);
    assert.ok(found.length >= 2, 'quote AND claimed result should both flag');
    assert.ok(found.some((f) => f.name === 'attributed_quote'));
    assert.ok(found.some((f) => f.name === 'claimed_result'));
  });

  it('catches a quote with no named source', () => {
    assert.ok(
      detectFabrication('One of our clients said "this saved my week" and meant it.').length > 0,
    );
  });

  it('catches an invented customer even with no quotation marks', () => {
    assert.ok(detectFabrication('A dentist in Redondo now books twice as many cleanings.').length > 0);
  });

  // What the drafter is told to fall back on when there is no real quote.
  it('allows plural, unattributed sentiment', () => {
    assert.deepEqual(detectFabrication('Owners tell us it is one less thing to think about.'), []);
    assert.deepEqual(detectFabrication('The people we work with mostly want it off their plate.'), []);
  });

  it('allows ordinary copy that happens to mention customers', () => {
    assert.deepEqual(detectFabrication('We write your posts and you approve them by text.'), []);
    assert.deepEqual(
      detectFabrication('Booking is open all week — come in whenever suits you.'),
      [],
    );
  });

  /**
   * All four are real captions the guard wrongly flagged on its first live run,
   * every one of them clean. The cause was apostrophes being treated as quote
   * marks, so any two contractions in a sentence looked like reported speech. A
   * guard that fires on ordinary writing burns a rewrite on every post and pins
   * clean work to manual approval — worse than not having one.
   */
  it('leaves ordinary contractions alone', () => {
    for (const caption of [
      "The algorithm doesn't care how perfect your photo is—it cares that you didn't disappear.",
      "That typo you almost sent? We catch it. Your name doesn't deserve a spelling mistake.",
      "Your phone doesn't need another login. That's the whole point.",
      "We're open today until 6. Text us your schedule once and we'll handle the rest.",
    ]) {
      assert.deepEqual(detectFabrication(caption), [], `false positive on: ${caption}`);
    }
  });

  it('does not flag plural customers described in general', () => {
    assert.deepEqual(
      detectFabrication('We built this for South Bay salon owners and cafe managers who already have seventeen passwords.'),
      [],
    );
  });

  // The invented-event failure: given only "banana bread" in the offers, the
  // live drafter wrote a specific dated bake-off that never happened.
  it('catches a specific recent event the owner never reported', () => {
    for (const caption of [
      "3 banana bread batches, different bake times. We're testing all three this afternoon — which crumb wins?",
      'We taste-tested three batches this week to get the crumb right.',
      'We roasted a fresh single-origin yesterday and it is singing.',
    ]) {
      const found = detectFabrication(caption);
      assert.ok(
        found.some((f) => f.name === 'invented_event'),
        `should flag invented event: ${caption}`,
      );
    }
  });

  it('leaves evergreen habits and plain state alone', () => {
    for (const caption of [
      'Our banana bread is baked fresh every morning — come grab a slice.',
      "We're open today until 6. Swing by the patio.",
      'We write your posts and you approve them by text.',
      'Baked fresh daily. Lavender honey latte on the menu all week.',
    ]) {
      assert.deepEqual(
        detectFabrication(caption),
        [],
        `false positive on evergreen/state: ${caption}`,
      );
    }
  });

  it('a real quote still does NOT license an invented event or result', () => {
    // hasRealQuote justifies the quote and its speaker — not a fabricated dated
    // event or a made-up result alongside it.
    assert.ok(
      detectFabrication(
        'A regular told us: "best latte around." We roasted a fresh batch this afternoon just for the rush.',
        true,
      ).some((f) => f.name === 'invented_event'),
      'invented event must still flag even with a real quote present',
    );
    assert.ok(
      detectFabrication(
        'A regular said "love this place." She now books a table every single week.',
        true,
      ).some((f) => f.name === 'claimed_result'),
      'claimed result must still flag even with a real quote present',
    );
  });

  it('does not flag ordinary membership/guest/customer CTAs', () => {
    for (const caption of [
      'Become a member today and save on every cleaning.',
      'Bring a guest this weekend — first coffee is on us.',
      'Refer a customer and you both get a free month.',
      'Treat yourself like a regular: your usual, ready when you walk in.',
    ]) {
      assert.deepEqual(detectFabrication(caption), [], `false positive on CTA: ${caption}`);
    }
  });

  it('does not flag stative/sentiment phrasing near a recency word', () => {
    for (const caption of [
      "This week we're featuring seasonal drinks you'll love.",
      'We loved seeing you this weekend — come back soon.',
      'This month we are celebrating five years in the neighborhood.',
    ]) {
      assert.deepEqual(detectFabrication(caption), [], `false positive on stative: ${caption}`);
    }
  });

  it('stands down when the owner gave a real quote', () => {
    const caption = 'A regular told us: "best haircut in the South Bay." We will take it.';
    assert.ok(detectFabrication(caption).length > 0, 'flagged without a source quote');
    assert.deepEqual(
      detectFabrication(caption, true),
      [],
      'a real quote is exactly what we asked for',
    );
  });
});
