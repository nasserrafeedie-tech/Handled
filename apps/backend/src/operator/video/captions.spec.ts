import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  assTime,
  buildAssFile,
  captionsToAss,
  groupWordsIntoLines,
  hexToAssColor,
  type TranscriptWord,
} from './captions';

/**
 * Captions cannot be eyeballed in CI, so every craft rule the playbook states
 * is asserted here instead: line length, sync to speech, no overlap, safe-zone
 * position, brand accent. A caption bug is invisible in a test that only checks
 * the file encodes — it ships as a reel with words in the wrong place.
 */

const words = (spec: Array<[string, number, number]>): TranscriptWord[] =>
  spec.map(([text, start, end]) => ({ text, start, end }));

describe('ASS timestamps', () => {
  it('formats seconds as H:MM:SS.cc', () => {
    assert.equal(assTime(0), '0:00:00.00');
    assert.equal(assTime(9.5), '0:00:09.50');
    assert.equal(assTime(61.25), '0:01:01.25');
  });

  it('never emits a .100 centisecond field', () => {
    // Rounding 3.999 up carries to 100 centiseconds; printed literally that is
    // an invalid timestamp and libass silently drops the whole caption.
    assert.equal(assTime(3.999), '0:00:04.00');
  });

  it('clamps negative times rather than printing a negative timestamp', () => {
    assert.equal(assTime(-5), '0:00:00.00');
  });
});

describe('brand colour conversion', () => {
  it('swaps RGB into ASS byte order', () => {
    // #C9A227 → &H00 + BB GG RR. Getting this backwards does not error, it just
    // renders the accent as an unrelated colour.
    assert.equal(hexToAssColor('#C9A227'), '&H0027A2C9');
  });

  it('accepts a hex without the hash', () => {
    assert.equal(hexToAssColor('8A2E3B'), '&H003B2E8A');
  });

  it('falls back rather than emitting a malformed colour', () => {
    // A brand profile with a junk colour must cost the accent, not the reel.
    assert.equal(hexToAssColor('not-a-colour'), '&H00FFFFFF');
    assert.equal(hexToAssColor(undefined), '&H00FFFFFF');
  });
});

describe('grouping words into caption lines', () => {
  it('caps a line at four words, per the playbook', () => {
    const lines = groupWordsIntoLines(
      words([
        ['one', 0, 0.3], ['two', 0.3, 0.6], ['three', 0.6, 0.9],
        ['four', 0.9, 1.2], ['five', 1.2, 1.5], ['six', 1.5, 1.8],
      ]),
    );
    assert.ok(lines.length >= 2, 'six words must not sit on one line');
    for (const l of lines) {
      assert.ok(l.text.split(' ').length <= 4, `too many words: "${l.text}"`);
    }
  });

  it('breaks at a full stop so a line is one complete thought', () => {
    const lines = groupWordsIntoLines(
      words([['Fresh', 0, 0.3], ['bread.', 0.3, 0.6], ['Every', 0.6, 0.9], ['day', 0.9, 1.2]]),
    );
    assert.equal(lines[0].text, 'Fresh bread.');
  });

  it('keeps lines in sync with speech', () => {
    const lines = groupWordsIntoLines(words([['hello', 2.0, 2.4], ['there', 2.4, 2.8]]));
    assert.equal(lines[0].start, 2.0, 'a caption must appear when the word is said');
  });

  it('never overlaps two captions on screen', () => {
    // A short word gets a minimum hold; without trimming, that hold would run
    // past the next line's entrance and libass would stack both on screen.
    const lines = groupWordsIntoLines(
      words([['a', 0, 0.05], ['b', 0.2, 0.25], ['c', 0.4, 0.45], ['d', 0.6, 0.65],
             ['e', 0.8, 0.85], ['f', 1.0, 1.05], ['g', 1.2, 1.25], ['h', 1.4, 1.45]]),
    );
    for (let i = 0; i < lines.length - 1; i++) {
      assert.ok(
        lines[i].end <= lines[i + 1].start,
        `line ${i} ends at ${lines[i].end}, after line ${i + 1} starts at ${lines[i + 1].start}`,
      );
    }
  });

  it('drops words with impossible timings instead of emitting bad events', () => {
    const lines = groupWordsIntoLines(
      words([['ok', 0, 0.5], ['broken', 2, 1], ['   ', 3, 4]]),
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'ok');
  });

  it('returns nothing for silent footage rather than an empty caption', () => {
    assert.deepEqual(groupWordsIntoLines([]), []);
  });
});

describe('the ASS file', () => {
  const sample = words([['Fresh', 0, 0.4], ['pastries', 0.4, 1.0], ['daily', 1.0, 1.4]]);

  it('declares the reel canvas so positions scale correctly', () => {
    const ass = captionsToAss(sample);
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /PlayResY: 1920/);
  });

  it('positions captions in the upper-middle third, clear of platform UI', () => {
    const ass = captionsToAss(sample);
    // Alignment 8 (top-centre) with a 700px top margin. Anchoring to the bottom
    // would bury the captions under Instagram's own caption and buttons.
    assert.match(ass, /,8,80,80,700,1/);
  });

  it('paints the emphasis word in the brand accent and resets afterwards', () => {
    const ass = captionsToAss(sample, { accentHex: '#C9A227' });
    assert.ok(ass.includes('{\\c&H0027A2C9}'), 'brand accent missing from the line');
    assert.ok(ass.includes('{\\r}'), 'emphasis must reset, or it bleeds into later words');
  });

  it('picks the caption font from the brand style', () => {
    assert.match(captionsToAss(sample, { brandStyle: 'bold' }), /Style: Cap,Anton,/);
    assert.match(captionsToAss(sample, { brandStyle: 'luxe' }), /Style: Cap,Marcellus,/);
    assert.match(captionsToAss(sample, { brandStyle: 'editorial' }), /Style: Cap,Playfair Display,/);
    assert.match(captionsToAss(sample, {}), /Style: Cap,Poppins,/);
  });

  it('carries an outline, so white text survives pale footage', () => {
    // BorderStyle 1 with outline 6 / shadow 3 — without it, captions vanish the
    // moment an owner films something bright.
    assert.match(captionsToAss(sample), /,1,6,3,8,/);
  });

  it('emits one event per line', () => {
    const events = captionsToAss(sample).split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.equal(events.length, 1, 'three short words belong on one line');
    assert.match(events[0], /Dialogue: 0,0:00:00\.00,0:00:01\.40,Cap,,0,0,0,,/);
  });

  it('neutralises libass control characters in the transcript', () => {
    // Braces open an override block: passed through, an owner saying something
    // transcribed with a brace would mangle or blank the caption.
    const ass = captionsToAss(words([['{\\an8}hack', 0, 1], ['ok', 1, 2]]));
    const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:')).join('\n');
    assert.ok(!dialogue.includes('{\\an8}'), 'override block reached the output');
  });

  it('produces a header-only file for silent footage', () => {
    const ass = buildAssFile([]);
    assert.match(ass, /\[Events\]/);
    assert.ok(!ass.includes('Dialogue:'), 'no speech must mean no caption events');
  });
});
