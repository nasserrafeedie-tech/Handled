import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

const run = promisify(execFile);

/**
 * Visual motion analysis, for the reel's dynamic cold-open (#1).
 *
 * The editor reads the transcript, so it is blind to what is happening on
 * screen — it cannot tell that the "main point" was said to a static camera.
 * This measures the picture directly: ffmpeg's scene-change detector reports a
 * mean-absolute-frame-difference (MAFD) per frame, which is high when the image
 * is moving (a gesture, a walk, a reveal) and near zero when it is still. From
 * that we find the single most visually alive moment to open the reel on.
 *
 * Kept as a pure window-picker (`pickBestWindow`) plus a thin ffmpeg wrapper, so
 * the interesting logic is unit-testable without a video fixture.
 */

/** One frame's motion reading. */
export interface MotionSample {
  time: number;
  mafd: number;
}

/** The most dynamic window found, and how it compares to the clip overall. */
export interface MotionWindow {
  /** Where the window starts, seconds into the clip. */
  start: number;
  /** Average motion inside the window. */
  score: number;
  /** Average motion across the whole clip. */
  avg: number;
  /** score / avg — how much the window stands out. 1 = nothing stands out. */
  ratio: number;
}

/**
 * Pick the `windowSecs`-long window with the highest average motion.
 *
 * Returns the standout window plus how much it beats the clip's baseline
 * (`ratio`), so the caller can decide whether there's a moment worth opening on
 * at all — uniformly static talking-head footage has a ratio near 1 and should
 * get no cold-open rather than a pointless flash. Returns null when there isn't
 * enough signal to choose.
 */
export function pickBestWindow(
  samples: MotionSample[],
  windowSecs: number,
): MotionWindow | null {
  const pts = samples.filter((s) => Number.isFinite(s.time) && Number.isFinite(s.mafd));
  if (pts.length < 3) return null;

  const avg = pts.reduce((sum, s) => sum + s.mafd, 0) / pts.length;
  if (avg <= 0) return null;

  let best: MotionWindow | null = null;
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].time;
    const windowEnd = start + windowSecs;
    let sum = 0;
    let count = 0;
    for (let j = i; j < pts.length && pts[j].time < windowEnd; j++) {
      sum += pts[j].mafd;
      count++;
    }
    // Need most of the window covered by samples, or a short tail window would
    // win on one loud frame.
    if (count < 2) continue;
    const score = sum / count;
    if (!best || score > best.score) {
      best = { start, score, avg, ratio: score / avg };
    }
  }
  return best;
}

/** Parse the `metadata=print` output of an scdet pass into motion samples. */
export function parseMotionSamples(text: string): MotionSample[] {
  const samples: MotionSample[] = [];
  let time: number | null = null;
  for (const line of text.split('\n')) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) {
      time = Number(t[1]);
      continue;
    }
    const m = /lavfi\.scd\.mafd=([\d.]+)/.exec(line);
    if (m && time !== null) {
      samples.push({ time, mafd: Number(m[1]) });
      time = null;
    }
  }
  return samples;
}

/**
 * Measure a clip's motion and return its most dynamic window.
 *
 * Uses ffmpeg's scdet filter (present in the bundled ffmpeg-static — verified),
 * which emits a per-frame MAFD as metadata. `file=-` forces the metadata to the
 * output regardless of log level. Returns null on any failure: a cold-open is a
 * bonus, never something a reel depends on.
 */
export async function probeMotion(
  path: string,
  windowSecs = 1.2,
): Promise<MotionWindow | null> {
  try {
    const { stdout, stderr } = await run(
      ffmpegPath,
      [
        '-hide_banner',
        '-threads', '2',
        '-i', path,
        '-vf', 'scdet=s=0,metadata=print:file=-',
        '-an', '-sn', '-f', 'null', '-',
      ],
      { timeout: 90_000, maxBuffer: 32 * 1024 * 1024 },
    );
    const samples = parseMotionSamples(`${stdout}\n${stderr}`);
    return pickBestWindow(samples, windowSecs);
  } catch {
    return null;
  }
}
