import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ReelEdl,
  clampEdl,
  edlDuration,
  fallbackEdl,
  mapWordsToTimeline,
  MAX_REEL_SECS,
} from './edl';

/**
 * The EDL is the seam where a model's guesses become instructions for a
 * renderer. Everything here is about that boundary: the model estimates times
 * from a transcript, it does not measure the file, so an EDL that asks for
 * footage which does not exist is expected input rather than an exotic case.
 */

describe('the EDL schema', () => {
  it('rejects an edit with no segments — that is not an edit', () => {
    assert.equal(ReelEdl.safeParse({ segments: [], hook: 'Watch this' }).success, false);
  });

  it('rejects extra fields, so a renamed field fails loudly instead of silently', () => {
    const parsed = ReelEdl.safeParse({
      segments: [{ clip_index: 0, start: 0, end: 2 }],
      hook: 'Watch this',
      music: 'upbeat',
    });
    assert.equal(parsed.success, false);
  });
});

describe('clamping a model-authored edit to real footage', () => {
  it('pulls a segment back inside its clip', () => {
    // The model asked for 0–90s of a 6-second clip. Unclamped this encodes
    // black frames or fails the render outright.
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 0, end: 90 }], hook: 'x' },
      [6],
    );
    assert.equal(out.segments.length, 1);
    assert.ok(out.segments[0].end <= 6, `end ${out.segments[0].end} exceeds the clip`);
  });

  it('drops a segment pointing at a clip that does not exist', () => {
    const out = clampEdl(
      {
        segments: [
          { clip_index: 0, start: 0, end: 2 },
          { clip_index: 7, start: 0, end: 2 },
        ],
        hook: 'x',
      },
      [5],
    );
    assert.equal(out.segments.length, 1);
    assert.equal(out.segments[0].clip_index, 0);
  });

  it('drops a segment whose start is after its end', () => {
    // Zero-length segments desync the concat rather than simply being ignored.
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 4, end: 4 }], hook: 'x' },
      [10],
    );
    for (const s of out.segments) assert.ok(s.end > s.start, 'zero-length segment survived');
  });

  it('caps a single segment so the cut rhythm holds', () => {
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 0, end: 30 }], hook: 'x' },
      [60],
    );
    assert.ok(out.segments[0].end - out.segments[0].start <= 4, 'one shot ran too long');
  });

  it('stops at the length cap instead of trailing off mid-segment', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ clip_index: i, start: 0, end: 3 }));
    const out = clampEdl({ segments: many, hook: 'x' }, many.map(() => 10));
    assert.ok(
      edlDuration(out) <= MAX_REEL_SECS,
      `reel ran ${edlDuration(out)}s, past the ${MAX_REEL_SECS}s cap`,
    );
    // Every surviving segment must be whole — the cap truncates the list, not
    // the last clip.
    for (const s of out.segments) assert.equal(s.end - s.start, 3);
  });

  it('discards a segment too short to read as a cut', () => {
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 0, end: 0.2 }], hook: 'x' },
      [10],
    );
    assert.equal(out.segments.length, 0);
  });
});

describe('the fallback edit', () => {
  it('uses every clip in order when there is nothing to reason about', () => {
    const out = fallbackEdl([10, 10], 'Watch this');
    assert.equal(out.segments.length, 2);
    assert.deepEqual(out.segments.map((s) => s.clip_index), [0, 1]);
  });

  it('never emits a segment longer than the clip behind it', () => {
    const out = fallbackEdl([1.2], 'x');
    assert.ok(out.segments[0].end <= 1.2);
  });

  it('skips a clip we could not measure rather than guessing its length', () => {
    assert.equal(fallbackEdl([0], 'x').segments.length, 0);
  });
});

describe('remapping captions onto the finished timeline', () => {
  it('shifts words to where they land after the trim', () => {
    // Clip trimmed from 4.5s; a word spoken at 6.0s lands 1.5s into the reel.
    const words = mapWordsToTimeline(
      { segments: [{ clip_index: 0, start: 4.5, end: 8 }], hook: 'x' },
      [[{ text: 'hello', start: 6.0, end: 6.4 }]],
    );
    assert.equal(words.length, 1);
    assert.ok(Math.abs(words[0].start - 1.5) < 1e-9, `landed at ${words[0].start}, expected 1.5`);
  });

  it('follows the edit order, not the clip order', () => {
    // The edit opens on clip 1. Its captions must come first, or every caption
    // in the reel describes the wrong shot.
    const words = mapWordsToTimeline(
      {
        segments: [
          { clip_index: 1, start: 0, end: 2 },
          { clip_index: 0, start: 0, end: 2 },
        ],
        hook: 'x',
      },
      [
        [{ text: 'second', start: 0.5, end: 1.0 }],
        [{ text: 'first', start: 0.5, end: 1.0 }],
      ],
    );
    assert.deepEqual(words.map((w) => w.text), ['first', 'second']);
    assert.ok(words[1].start >= 2, 'the second clip’s words must sit after the first cut');
  });

  it('drops speech the edit cut out', () => {
    // Captioning a word the viewer never hears puts text on screen for footage
    // that is not in the reel.
    const words = mapWordsToTimeline(
      { segments: [{ clip_index: 0, start: 0, end: 2 }], hook: 'x' },
      [[{ text: 'kept', start: 0.5, end: 1 }, { text: 'cut', start: 5, end: 5.5 }]],
    );
    assert.deepEqual(words.map((w) => w.text), ['kept']);
  });

  it('drops a word the trim cuts in half', () => {
    // Half a word would render clamped to the boundary — a caption for speech
    // the viewer only hears the tail of.
    const words = mapWordsToTimeline(
      { segments: [{ clip_index: 0, start: 0, end: 2 }], hook: 'x' },
      [[{ text: 'straddling', start: 1.8, end: 2.4 }]],
    );
    assert.equal(words.length, 0);
  });

  it('handles a clip with no transcript beside one that has speech', () => {
    // Silent b-roll intercut with talking is the normal case, not an edge one.
    const words = mapWordsToTimeline(
      {
        segments: [
          { clip_index: 0, start: 0, end: 2 },
          { clip_index: 1, start: 0, end: 2 },
        ],
        hook: 'x',
      },
      [undefined, [{ text: 'talking', start: 0.5, end: 1 }]],
    );
    assert.deepEqual(words.map((w) => w.text), ['talking']);
    assert.ok(words[0].start >= 2, 'must sit after the silent clip');
  });
});
