import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { strategySummary } from './strategy-summary';

const profile = { businessType: 'bakery in Pasadena', voiceTone: 'warm', postingFrequency: 3 } as never;
const at = (h: number) => new Date(Date.UTC(2026, 10, 18, h));

describe('"what\'s coming up" (F17)', () => {
  it('marks drafts waiting on the owner, in time order', () => {
    const text = strategySummary({
      profile,
      archetype: null,
      businessName: 'Rosa',
      timezone: 'America/Los_Angeles',
      postedLast30: 0,
      upcoming: [
        { caption: 'Sourdough is back', scheduledTime: at(17), status: 'scheduled' },
        { caption: 'Pumpkin loaf this weekend', scheduledTime: at(20), status: 'pending_approval' },
      ] as never,
    });
    const lines = text.split('\n');
    const i = lines.indexOf('Coming up:');
    assert.match(lines[i + 1], /Sourdough is back"$/);
    assert.match(lines[i + 2], /Pumpkin loaf.*waiting on your OK/);
  });

  it('never hides the next post behind waiting drafts, and counts what it leaves off', () => {
    const text = strategySummary({
      profile,
      archetype: null,
      businessName: 'Rosa',
      timezone: 'America/Los_Angeles',
      postedLast30: 0,
      upcoming: [
        { caption: 'Sourdough is back', scheduledTime: at(15), status: 'scheduled' },
        { caption: 'Draft one', scheduledTime: at(16), status: 'pending_approval' },
        { caption: 'Draft two', scheduledTime: at(17), status: 'pending_approval' },
        { caption: 'Draft three', scheduledTime: at(18), status: 'pending_approval' },
        { caption: 'Draft four', scheduledTime: at(19), status: 'pending_approval' },
        { caption: 'Draft five', scheduledTime: at(20), status: 'pending_approval' },
      ] as never,
    });
    assert.match(text, /Sourdough is back/);
    assert.doesNotMatch(text, /Draft four/);
    assert.match(text, /and 2 more \(all waiting on your OK\)/);
  });

  it('a scheduled-only week reads as before', () => {
    const text = strategySummary({
      profile,
      archetype: null,
      businessName: null,
      timezone: 'America/Los_Angeles',
      postedLast30: 2,
      upcoming: [{ caption: 'Sourdough is back', scheduledTime: at(17), status: 'scheduled' }] as never,
    });
    assert.doesNotMatch(text, /waiting/);
    assert.match(text, /2 posts went out/);
  });
});
