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

  it('never groups words from two different segments onto one line', () => {
    // The garbled-caption bug from real footage: adjacent-in-time words that
    // belong to different clips must break, not merge.
    const lines = groupWordsIntoLines([
      { text: 'got', start: 3.6, end: 3.8, segment: 0 },
      { text: 'pretty', start: 3.8, end: 4.0, segment: 0 },
      { text: "What's", start: 4.0, end: 4.2, segment: 1 },
      { text: 'up', start: 4.2, end: 4.4, segment: 1 },
    ]);
    assert.equal(lines.length, 2, 'the cut must split these into two lines');
    assert.equal(lines[0].text, 'got pretty');
    assert.equal(lines[1].text, "What's up");
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

  it('emits a karaoke event per word, together spanning the line', () => {
    // The line stays on screen while the highlight travels word to word, so
    // there is one Cap event per word, back to back across the line's window.
    const events = captionsToAss(sample).split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.equal(events.length, 3, 'one event per spoken word');
    assert.match(events[0], /Dialogue: 0,0:00:00\.00,0:00:00\.40,Cap,,0,0,0,,/);
    assert.match(events[2], /,0:00:01\.40,Cap,/, 'last word runs to the line end');
  });

  it('drops filler words (um, uh) from the on-screen captions', () => {
    const ass = captionsToAss(words([['So', 0, 0.3], ['um', 0.3, 0.6], ['fresh', 0.6, 1.0]]));
    const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:')).join(' ');
    assert.ok(!/\bum\b/.test(dialogue), 'filler word reached the caption');
    assert.ok(/fresh/.test(dialogue), 'real words must survive');
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

describe('the hook, carried in the same file', () => {
  const words = [{ text: 'hello', start: 0, end: 1 }];

  it('emits a hook event over the opening 3 seconds', () => {
    const ass = captionsToAss(words, { hookText: 'The secret nobody tells you' });
    const hook = ass.split('\n').find((l) => l.startsWith('Dialogue:') && l.includes('Hook,'));
    assert.ok(hook, 'no Hook dialogue line emitted');
    assert.match(hook!, /Dialogue: 1,0:00:00\.00,0:00:03\.00,Hook,.*The secret nobody tells you/);
  });

  it('draws the hook on a higher layer than the captions', () => {
    // A caption sharing the first 3 seconds must not stack on top of the hook;
    // the hook is layer 1, captions layer 0, so the hook wins.
    const dialogue = captionsToAss(words, { hookText: 'Watch this' })
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'));
    const hook = dialogue.find((l) => l.includes(',Hook,'))!;
    const cap = dialogue.find((l) => l.includes(',Cap,'))!;
    assert.match(hook, /^Dialogue: 1,/);
    assert.match(cap, /^Dialogue: 0,/);
  });

  it('gives the hook a boxed style filled with the brand accent', () => {
    // BorderStyle 3 = opaque box; the OutlineColour field is the box fill and
    // must carry the brand accent, not stay black.
    const ass = captionsToAss(words, { accentHex: '#C9A227', hookText: 'Hi' });
    const style = ass.split('\n').find((l) => l.startsWith('Style: Hook,'))!;
    assert.ok(style.includes('&H0027A2C9'), 'hook box is not filled with the accent');
    assert.match(style, /,3,18,0,8,/, 'hook is not an opaque top-centred box');
  });

  const hasHookEvent = (ass: string) =>
    ass.split('\n').some((l) => l.startsWith('Dialogue:') && l.includes(',Hook,'));

  it('adds no hook event when none is given', () => {
    // The Hook style is always declared in the header; what must be absent is
    // the Dialogue event that actually draws one.
    assert.equal(hasHookEvent(captionsToAss(words, {})), false);
  });

  it('carries a hook even when there is no speech to caption', () => {
    // Silent b-roll still gets its hook — the opening text is what earns
    // distribution, independent of whether anyone is talking.
    assert.equal(hasHookEvent(captionsToAss([], { hookText: 'Watch this' })), true);
  });
});
