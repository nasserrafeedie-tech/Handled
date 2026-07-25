import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isValidTimeZone, zonedToUtc } from './time';

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', 'Europe/London', 'Asia/Tokyo']) {
      assert.equal(isValidTimeZone(tz), true, tz);
    }
  });

  it('rejects junk that would silently degrade to UTC', () => {
    // Anything Intl cannot resolve. (Note: "PST"/"GMT" ARE resolvable, so they
    // are intentionally accepted — they never fall back to UTC.)
    for (const tz of ['California', '', 'Not/AZone', 'GMT+5abc', 'Mars/Base']) {
      assert.equal(isValidTimeZone(tz), false, tz);
    }
  });
});

describe('zonedToUtc', () => {
  it('resolves a wall-clock slot to the right UTC instant', () => {
    // 9am Pacific on a summer date is 16:00 UTC (PDT, UTC-7).
    const utc = zonedToUtc('2026-07-20', '09:00', 'America/Los_Angeles');
    assert.equal(utc.toISOString(), '2026-07-20T16:00:00.000Z');
  });

  it('THROWS on a malformed date instead of silently returning now', () => {
    // Returning "now" turned a bad slot into an immediate publish.
    assert.throws(() => zonedToUtc('not-a-date', '09:00', 'America/Los_Angeles'));
    assert.throws(() => zonedToUtc('2026-07-20', 'nonsense', 'America/Los_Angeles'));
  });
});
