import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { photoWalkInvite, photoWalkReminder, shotListFor } from './photo-walk';

describe('photo walk shot list', () => {
  it('every business gets the core walk, faces first', () => {
    const shots = shotListFor('some brand new kind of business');
    assert.ok(shots.length >= 8);
    assert.equal(shots[0].key, 'owner_face', 'the owner face is the first, most valuable ask');
    const keys = shots.map((s) => s.key);
    for (const k of ['hands_at_work', 'team', 'before', 'tool']) {
      assert.ok(keys.includes(k), `core walk missing ${k}`);
    }
  });

  it('verticals swap in trade-specific shots without losing the core', () => {
    const dental = shotListFor('family dental practice');
    assert.ok(dental.some((s) => s.key === 'comfort'), 'dental gets the comfort shot');
    assert.equal(dental[0].key, 'owner_face', 'face still leads');

    const cafe = shotListFor('neighborhood coffee shop and bakery');
    assert.ok(cafe.some((s) => s.key === 'process'), 'cafe gets a mid-make shot');
    assert.match(cafe.find((s) => s.key === 'todays_best')!.title, /plate or pour/i);

    const detailer = shotListFor('mobile car detailing');
    assert.match(detailer.find((s) => s.key === 'before')!.title, /filthiest/i);
  });

  it('shot keys are stable identifiers (no spaces, lowercase)', () => {
    for (const s of shotListFor('barber shop')) {
      assert.match(s.key, /^[a-z_]+$/, `key "${s.key}" is not a stable identifier`);
    }
  });

  it('invite and reminder both carry the personal walk link', () => {
    const invite = photoWalkInvite('https://texthandled.com', 'cust-123');
    const reminder = photoWalkReminder('https://texthandled.com', 'cust-123');
    for (const msg of [invite, reminder]) {
      assert.match(msg, /https:\/\/texthandled\.com\/photo-walk\?c=cust-123/);
    }
    assert.match(invite, /real photos/i, 'the invite sells the why');
  });
});
