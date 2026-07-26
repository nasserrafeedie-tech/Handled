import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ReelEdl,
  clampEdl,
  edlDuration,
  fallbackEdl,
  tightenEdl,
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

describe('snapping a cut to word boundaries (cut on meaning)', () => {
  // "the crispy chicken sandwich is here" — one word per entry, real timings.
  const words = [
    { text: 'the', start: 1.0, end: 1.3 },
    { text: 'crispy', start: 1.4, end: 1.9 },
    { text: 'chicken', start: 2.0, end: 2.6 },
    { text: 'sandwich', start: 2.7, end: 3.4 },
    { text: 'is', start: 3.5, end: 3.7 },
    { text: 'here', start: 3.8, end: 4.2 },
  ];

  it('moves the trim onto word edges, never mid-word', () => {
    // The model asked for 1.15–3.6, both landing inside words.
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 1.15, end: 3.6 }], hook: 'x' },
      [10],
      [words],
    );
    assert.equal(out.segments.length, 1);
    const seg = out.segments[0];
    // Start snaps up to a word start, end back to a word end — every boundary
    // coincides with a real word edge.
    assert.ok(
      words.some((w) => Math.abs(w.start - seg.start) < 1e-9),
      `start ${seg.start} is not a word boundary`,
    );
    assert.ok(
      words.some((w) => Math.abs(w.end - seg.end) < 1e-9),
      `end ${seg.end} is not a word boundary`,
    );
  });

  it('keeps the raw times when the clip has no words (b-roll)', () => {
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 0, end: 3 }], hook: 'x' },
      [10],
      [[]],
    );
    assert.equal(out.segments.length, 1);
    assert.equal(out.segments[0].start, 0);
  });

  it('extends to finish a sentence instead of cutting through it', () => {
    // Two sentences: "Welcome to the shop." then "We make everything fresh
    // daily here". The model asks to end at 3.5 — the middle of the second
    // sentence. The cut must extend to the sentence's end (4.9), never stop
    // mid-thought.
    const words = [
      { text: 'Welcome', start: 1.0, end: 1.4 },
      { text: 'to', start: 1.4, end: 1.6 },
      { text: 'the', start: 1.6, end: 1.8 },
      { text: 'shop.', start: 1.8, end: 2.2 },
      { text: 'We', start: 2.6, end: 2.8 },
      { text: 'make', start: 2.8, end: 3.1 },
      { text: 'everything', start: 3.1, end: 3.7 },
      { text: 'fresh', start: 3.7, end: 4.1 },
      { text: 'daily', start: 4.1, end: 4.5 },
      { text: 'here', start: 4.5, end: 4.9 },
    ];
    const out = clampEdl(
      { segments: [{ clip_index: 0, start: 1.0, end: 3.5 }], hook: 'x' },
      [10],
      [words],
    );
    assert.equal(out.segments.length, 1);
    const seg = out.segments[0];
    const sentenceEnds = [2.2, 4.9]; // the two complete-thought boundaries
    assert.ok(
      sentenceEnds.some((e) => Math.abs(e - seg.end) < 1e-9),
      `end ${seg.end} did not land on a sentence boundary`,
    );
    assert.ok(seg.end > 3.5, 'should have extended to finish the sentence, not chopped at 3.5');
  });
});

describe('keep-and-tighten (CapCut speech-pause style)', () => {
  // Two spoken runs with 1.8s of dead air between them.
  const words = [
    { text: 'Welcome', start: 1.0, end: 1.4 },
    { text: 'to', start: 1.4, end: 1.6 },
    { text: 'the', start: 1.6, end: 1.9 },
    { text: 'shop', start: 1.9, end: 2.2 },
    // --- 1.8s silence ---
    { text: 'We', start: 4.0, end: 4.2 },
    { text: 'make', start: 4.2, end: 4.5 },
    { text: 'everything', start: 4.5, end: 5.1 },
    { text: 'fresh', start: 5.1, end: 5.5 },
  ];

  it('keeps every speech run and drops the dead air between them', () => {
    const edl = tightenEdl([10], [words], 'hook');
    assert.equal(edl.segments.length, 2, 'both runs kept');
    const [a, b] = edl.segments;
    // Run starts are the phrase starts.
    assert.equal(a.start, 1.0);
    assert.equal(b.start, 4.0);
    // First run's end is padded a little past the last word (2.2) for breathing
    // room, but never into the next run (4.0) — the dead air is still dropped.
    assert.ok(a.end > 2.2 && a.end < 4.0, `first run end ${a.end} leaked the silence`);
    assert.ok(a.end < b.start, 'silence between runs was dropped');
    // Last run's end is padded past the final word (5.5) to recover the tail,
    // capped at the clip duration.
    assert.ok(b.end >= 5.5 && b.end <= 10, `last run end ${b.end} out of range`);
  });

  it('keeps a b-roll clip (no speech) whole but capped', () => {
    const edl = tightenEdl([12], [[]], 'hook');
    assert.equal(edl.segments.length, 1);
    assert.equal(edl.segments[0].start, 0);
    assert.ok(edl.segments[0].end <= 4, 'b-roll shot stays punchy');
  });

  it('never exceeds the reel cap even with lots of speech', () => {
    const many = { text: 'word', start: 0, end: 40 };
    const edl = tightenEdl([50], [[{ ...many }]], 'hook');
    assert.ok(edlDuration(edl) <= MAX_REEL_SECS, 'tighten respected the reel cap');
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

  it('tags each word with its segment so captions never cross a cut', () => {
    // The real-footage bug: a caption line merged the tail of a beach clip with
    // the head of an intro clip ("got pretty What's up") because grouping ran
    // by time alone across the seam. The segment tag is what lets the caption
    // grouper break at the cut.
    const words = mapWordsToTimeline(
      {
        segments: [
          { clip_index: 0, start: 0, end: 2 },
          { clip_index: 1, start: 0, end: 2 },
        ],
        hook: 'x',
      },
      [
        [{ text: 'beach', start: 1.8, end: 1.95 }],
        [{ text: 'intro', start: 0.1, end: 0.3 }],
      ],
    );
    // The two words land microseconds apart on the timeline but carry different
    // segment tags, which is exactly what stops them sharing a line.
    const beach = words.find((w) => w.text === 'beach')!;
    const intro = words.find((w) => w.text === 'intro')!;
    assert.equal(beach.segment, 0);
    assert.equal(intro.segment, 1);
    assert.ok(intro.start - beach.end < 0.3, 'the words really are adjacent on the timeline');
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
