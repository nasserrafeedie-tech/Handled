import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { formatInZone, isValidTimeZone, parseTimeLocally, zonedToUtc } from './time';

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

describe('reading timing without the model', () => {
  // Tue Nov 17 2026, 9:00 PM in Los Angeles.
  const now = new Date('2026-11-18T05:00:00Z');
  const tz = 'America/Los_Angeles';
  const at = (s: string, planned?: Date) => parseTimeLocally(s, tz, now, planned)?.toISOString() ?? null;

  it('reads a weekday and a time', () => {
    assert.equal(at('move the next one to Thursday at 2pm'), '2026-11-19T22:00:00.000Z');
    assert.equal(at('friday 9:30am'), '2026-11-20T17:30:00.000Z');
  });

  it('reads now, tomorrow and a bare time', () => {
    assert.equal(at('post it now'), now.toISOString());
    assert.equal(at('tomorrow at noon'), '2026-11-18T20:00:00.000Z');
    assert.equal(at('do it at 8pm'), '2026-11-19T04:00:00.000Z', '8pm already passed today, so tomorrow');
  });

  it("keeps the post's time of day when only a day is named", () => {
    assert.equal(at('move it to saturday', new Date('2026-11-17T17:00:00Z')), '2026-11-21T17:00:00.000Z');
  });

  it('says nothing when there is no timing', () => {
    assert.equal(at('make it shorter'), null);
  });
});

describe('saying when a post goes out', () => {
  const tz = 'America/Los_Angeles';
  // Mon Nov 16, 9:44 PM in Los Angeles.
  const now = new Date('2026-11-17T05:44:00Z');
  it('says today or tomorrow for the next two days', () => {
    assert.equal(formatInZone(new Date('2026-11-17T06:30:00Z'), tz, now), 'today 10:30 PM');
    assert.equal(formatInZone(new Date('2026-11-17T18:00:00Z'), tz, now), 'tomorrow 10:00 AM');
  });
  it('gives a weekday within the week and the date past it', () => {
    assert.equal(formatInZone(new Date('2026-11-19T01:00:00Z'), tz, now), 'Wed 5:00 PM');
    assert.equal(formatInZone(new Date('2026-11-24T20:30:00Z'), tz, now), 'Tue, Nov 24, 12:30 PM');
  });
});
