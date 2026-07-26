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
/** Longest B-ROLL slice (no speech). Visual shots stay punchy, ~2–3s. */
const MAX_SEGMENT_SECS = 4;
/**
 * Longest SPEECH slice. A spoken sentence routinely runs 4–6s, and the whole
 * point of cutting on meaning is to keep a thought intact — chopping it at the
 * b-roll cap is exactly the "cut off mid-sentence" complaint. So a segment that
 * ends on a sentence boundary is allowed to run to here before we force a cut.
 */
const MAX_SPEECH_SEGMENT_SECS = 7;
/** A silence longer than this between words reads as a sentence/phrase break. */
const PHRASE_GAP_SECS = 0.5;
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

    // Snap the cut to SENTENCE boundaries when we have this clip's transcript,
    // so a segment starts and ends on a complete spoken thought instead of
    // slicing through one. This is what makes the edit "cut on meaning": the
    // model picks the moment, and we align the actual trim to whole phrases —
    // extending a hair past the model's end to finish a sentence rather than
    // chop it. Falls back to raw times for b-roll (no words) or when no phrase
    // fits.
    const words = transcripts?.[seg.clip_index];
    const snapped =
      words && words.length ? snapToPhrases(rawStart, rawEnd, words) : null;

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

/** One spoken phrase/sentence: a run of words with no big pause or end-stop. */
interface Phrase {
  start: number;
  end: number;
}

/**
 * Group a clip's words into phrases. A phrase ends at sentence punctuation
 * (. ? !) or a silence longer than PHRASE_GAP_SECS — the two signals of a
 * complete thought that Whisper gives us. These are the units we cut on.
 */
function phrasesFromWords(words: TranscriptWord[]): Phrase[] {
  const phrases: Phrase[] = [];
  let startIdx = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const endsSentence = /[.!?]["')\]]?$/.test(w.text.trim());
    const gap = next ? next.start - w.end : Infinity;
    if (endsSentence || gap > PHRASE_GAP_SECS || !next) {
      phrases.push({ start: words[startIdx].start, end: w.end });
      startIdx = i + 1;
    }
  }
  return phrases;
}

/**
 * Align a raw [start, end] window to whole spoken phrases.
 *
 * The model estimates cut points from a transcript, so its numbers land a few
 * hundred ms off — and worse, a hard length cap used to chop a segment in the
 * middle of a sentence. Here we start at the phrase the model's start falls in
 * (or the next one, dropping any leading silence) and take whole phrases up to
 * about the model's end, ending ON a phrase boundary and extending slightly to
 * finish the current sentence rather than cut it. A single run-on phrase past
 * the speech cap is trimmed to whole words so nothing is sliced mid-word.
 * Returns null when no phrase fits, so the caller keeps the raw times.
 */
function snapToPhrases(
  rawStart: number,
  rawEnd: number,
  words: TranscriptWord[],
): { start: number; end: number } | null {
  const TOL = 0.12;
  const phrases = phrasesFromWords(words);
  if (!phrases.length) return null;

  // The phrase the model's start lands inside; else the next upcoming phrase
  // (model aimed into a silence), else give up.
  let i = phrases.findIndex(
    (p) => rawStart >= p.start - TOL && rawStart <= p.end + TOL,
  );
  if (i === -1) i = phrases.findIndex((p) => p.start >= rawStart - TOL);
  if (i === -1) return null;

  const start = Math.max(0, phrases[i].start);
  let end = phrases[i].end;
  // Add whole phrases until we reach the model's intended end, capped so a
  // segment stays a sentence or two — not a monologue.
  for (let j = i + 1; j < phrases.length; j++) {
    if (end >= rawEnd - TOL) break;
    if (phrases[j].end - start > MAX_SPEECH_SEGMENT_SECS) break;
    end = phrases[j].end;
  }

  // A single phrase longer than the cap (a run-on with no pause/punctuation):
  // fall back to trimming on whole words within it, so we never slice a word.
  if (end - start > MAX_SPEECH_SEGMENT_SECS) {
    const hardEnd = start + MAX_SPEECH_SEGMENT_SECS;
    let wordEnd = 0;
    for (const w of words) {
      if (w.start < start) continue;
      if (w.end <= hardEnd + TOL) wordEnd = w.end;
      else break;
    }
    end = wordEnd;
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
