import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { strategySummary } from './strategy-summary';

const profile = { businessType: 'bakery in Pasadena', voiceTone: 'warm', postingFrequency: 3 } as never;
const at = (h: number) => new Date(Date.UTC(2026, 10, 18, h));

describe('"what\'s coming up" (F17)', () => {
  it('lists drafts waiting on the owner first, and says they are waiting', () => {
    const text = strategySummary({
      profile,
      archetype: null,
      businessName: 'Rosa',
      timezone: 'America/Los_Angeles',
      postedLast30: 0,
      upcoming: [
        { caption: 'Sourdough is back', scheduledTime: at(17), status: 'scheduled' },
        { caption: 'Croissant Friday', scheduledTime: at(18), status: 'scheduled' },
        { caption: 'Holiday pre-orders open', scheduledTime: at(19), status: 'scheduled' },
        { caption: 'Pumpkin loaf this weekend', scheduledTime: at(20), status: 'pending_approval' },
      ] as never,
    });
    const lines = text.split('\n');
    const first = lines[lines.indexOf('Coming up:') + 1];
    assert.match(first, /Pumpkin loaf.*waiting on your OK/);
    assert.equal((text.match(/waiting on your OK/g) ?? []).length, 1);
    assert.match(text, /Sourdough is back/);
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
