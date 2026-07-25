import { z } from 'zod';
import type { TranscriptWord } from './captions';

/**
 * The Edit Decision List — what the model decided the reel should be.
 *
 * The LLM acts as the editor: it reads the transcript and returns which clips
 * to use, in what order, trimmed where. It does NOT return a video, and that
 * separation is the point — an edit plan is a small JSON object that can be
 * validated, clamped and unit-tested before a single frame is encoded. A model
 * that hallucinates "use clip 7 from 40s to 90s" for a two-clip, six-second
 * shoot produces a caught error here instead of a corrupt filtergraph or a reel
 * of black frames.
 *
 * The playbook rules the model is asked to follow (21–34s total, cut every 2–3
 * seconds, open on the payoff) are craft guidance, so the model applies them.
 * The rules that must not be violated — trims inside real footage, no
 * overlapping captions, a sane total length — are enforced here in code.
 */

/** One chosen slice of one source clip. Times are seconds within that clip. */
export const EdlSegment = z
  .object({
    /** Index into the clip list handed to the model. */
    clip_index: z.number().int().min(0),
    start: z.number().min(0),
    end: z.number().min(0),
    /**
     * Why this slice earns its place. Not rendered — it exists so a human
     * reviewing a bad reel can see what the editor thought it was doing.
     */
    reason: z.string().max(200).optional(),
  })
  .strict();
export type EdlSegment = z.infer<typeof EdlSegment>;

export const ReelEdl = z
  .object({
    segments: z.array(EdlSegment).min(1),
    /** On-screen hook for the opening seconds. */
    hook: z.string().min(1).max(90),
  })
  .strict();
export type ReelEdl = z.infer<typeof ReelEdl>;

/** Shortest slice worth cutting to — below this the cut reads as a stutter. */
const MIN_SEGMENT_SECS = 0.8;
/** Longest single slice. The playbook wants a shot change every 2–3 seconds. */
const MAX_SEGMENT_SECS = 4;
/** Upper bound on the finished reel, before the end card. */
export const MAX_REEL_SECS = 34;

/**
 * Force a model-authored EDL to describe footage that actually exists.
 *
 * Every clamp here corresponds to a way the render breaks: a segment past the
 * end of its source encodes black frames or fails outright; a start after its
 * own end makes ffmpeg emit a zero-length segment that desyncs the concat; an
 * out-of-range clip index reads an undefined path. None of these are unlikely —
 * the model is estimating times from a transcript, not measuring the file.
 */
export function clampEdl(
  edl: ReelEdl,
  clipDurations: number[],
  transcripts?: Array<TranscriptWord[] | undefined>,
): ReelEdl {
  const segments: EdlSegment[] = [];
  let total = 0;

  for (const seg of edl.segments) {
    const duration = clipDurations[seg.clip_index];
    // A clip the model invented has no duration — drop the segment rather than
    // guess which real clip was meant.
    if (duration === undefined || duration <= 0) continue;

    const rawStart = Math.min(Math.max(0, seg.start), Math.max(0, duration - MIN_SEGMENT_SECS));
    const rawEnd = Math.min(seg.end > rawStart ? seg.end : rawStart + MAX_SEGMENT_SECS, duration);

    // Snap the cut to word boundaries when we have this clip's transcript, so a
    // segment starts and ends between spoken words instead of slicing through
    // one. This is what makes the edit "cut on meaning": the model picks the
    // moment, and we align the actual trim to the nearest clean word edges,
    // trimming leading/trailing silence in the bargain. Falls back to the raw
    // times for b-roll (no words) or when snapping can't find a valid span.
    const words = transcripts?.[seg.clip_index];
    const snapped = words && words.length ? snapToWords(rawStart, rawEnd, words) : null;

    let start: number;
    let length: number;
    if (snapped) {
      start = snapped.start;
      length = snapped.end - snapped.start;
    } else {
      start = rawStart;
      length = Math.min(rawEnd - rawStart, MAX_SEGMENT_SECS);
    }
    if (length < MIN_SEGMENT_SECS) continue;

    // Stop at the length cap rather than trailing off mid-segment: a reel that
    // ends on a complete beat beats one truncated mid-sentence.
    if (total + length > MAX_REEL_SECS) break;

    segments.push({ ...seg, start, end: start + length });
    total += length;
  }

  return { ...edl, segments };
}

/**
 * Align a raw [start, end] window to the word timings of its clip.
 *
 * The model estimates cut points from a transcript, so its numbers land a few
 * hundred milliseconds off the real word edges — enough to clip the head off a
 * word or leave the tail of the previous one. We move the start up to the first
 * word that begins at/after it (dropping any leading silence) and the end back
 * to the last word that ends at/before it, capped to MAX_SEGMENT_SECS worth of
 * whole words. A small tolerance lets a word the model meant to include but
 * boxed a hair too tightly still count. Returns null when no whole word fits —
 * the caller then keeps the raw times rather than dropping a real moment.
 */
function snapToWords(
  rawStart: number,
  rawEnd: number,
  words: TranscriptWord[],
): { start: number; end: number } | null {
  const TOL = 0.12;
  const startWord = words.find((w) => w.start >= rawStart - TOL);
  if (!startWord) return null;
  const start = Math.max(0, startWord.start);

  // Take whole words up to the requested end, but never past the segment cap.
  const hardEnd = Math.min(rawEnd, start + MAX_SEGMENT_SECS);
  let end = 0;
  for (const w of words) {
    if (w.start < start) continue;
    if (w.end <= hardEnd + TOL) end = w.end;
    else break;
  }
  if (end - start < MIN_SEGMENT_SECS) return null;
  return { start, end };
}

/**
 * The fallback edit: every clip in the order it was sent, capped.
 *
 * Used when there is no transcript to reason about or the model's plan survives
 * clamping with nothing left. Reels must always produce output — a customer
 * whose transcription call timed out should get the old hard-cut reel, not an
 * error text. This is deliberately the pre-existing behaviour.
 */
export function fallbackEdl(clipDurations: number[], hook: string): ReelEdl {
  const segments = clipDurations
    .map((d, i) => ({ clip_index: i, start: 0, end: Math.min(d, 3.5) }))
    .filter((s) => s.end > s.start);
  return { segments, hook };
}

/**
 * Remap word timings from source-clip time onto the finished reel's timeline.
 *
 * This is what makes captions line up after editing. A word spoken 6 seconds
 * into clip 2 might land 1.5 seconds into a reel that opens on clip 2 trimmed
 * from 4.5s. Skip this and the captions still render — they just describe a
 * different moment than the one on screen, which is worse than no captions at
 * all, and it is invisible in every test that only checks the file encodes.
 *
 * Words falling outside a chosen slice are dropped: they belong to footage the
 * edit cut out, so captioning them would put words on screen that nobody says.
 */
export function mapWordsToTimeline(
  edl: ReelEdl,
  transcripts: Array<TranscriptWord[] | undefined>,
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let offset = 0;

  edl.segments.forEach((seg, segmentIndex) => {
    const words = transcripts[seg.clip_index] ?? [];
    for (const w of words) {
      // Require the whole word inside the slice. A word half-cut by the trim
      // would otherwise render clamped to the boundary, showing a caption for
      // speech the viewer only hears the tail of.
      if (w.start >= seg.start && w.end <= seg.end) {
        out.push({
          text: w.text,
          start: offset + (w.start - seg.start),
          end: offset + (w.end - seg.start),
          // Tag the source segment so caption grouping breaks at every cut —
          // words from two clips must never land on one line (see captions.ts).
          segment: segmentIndex,
        });
      }
    }
    offset += seg.end - seg.start;
  });

  return out.sort((a, b) => a.start - b.start);
}

/** Total runtime of the edit, seconds — excludes the end card. */
export function edlDuration(edl: ReelEdl): number {
  return edl.segments.reduce((t, s) => t + (s.end - s.start), 0);
}
