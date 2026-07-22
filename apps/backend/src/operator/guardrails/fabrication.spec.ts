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
