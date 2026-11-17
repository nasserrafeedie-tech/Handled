import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { starterWeek } from './concierge.service';
import { clampToWindow } from '../operator/handlers/plan-week.handler';

/**
 * QA round 5 (Nov 17): an owner who finished setup on a Monday night saw their
 * first post planned for the next Monday. A short starter week now covers the
 * days from tomorrow until the regular plan starts.
 */
describe('the starter week', () => {
  const tz = 'America/Los_Angeles';
  it('covers tomorrow up to the plan Monday', () => {
    // Mon Nov 16, 9:44 PM in Los Angeles; the regular plan starts Mon Nov 23.
    assert.deepEqual(starterWeek(tz, '2026-11-23T00:00:00.000Z', new Date('2026-11-17T05:44:00Z')), { start: '2026-11-17', days: 6 });
  });
  it('is skipped with under two days to go', () => {
    // Sat Nov 21, 10 AM: tomorrow is Sunday, one day before the plan.
    assert.equal(starterWeek(tz, '2026-11-23T00:00:00.000Z', new Date('2026-11-21T18:00:00Z')), null);
  });
  it('stays inside its days, one post a day', () => {
    const slots = ['2026-11-16', '2026-11-17', '2026-11-17', '2026-11-20', '2026-11-23'].map((date) => ({ date }));
    assert.deepEqual(clampToWindow(slots, '2026-11-17', 6).map((s) => s.date), ['2026-11-17', '2026-11-20']);
  });
});
