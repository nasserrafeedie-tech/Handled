import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

const run = promisify(execFile);

/**
 * How long a clip runs, in seconds.
 *
 * Read out of `ffmpeg -i` rather than ffprobe on purpose: ffmpeg-static ships
 * only the one binary, and pulling in ffprobe-static to read a single number
 * would add a second ~80MB platform-specific dependency to the Render image.
 *
 * ffmpeg with no output file always exits non-zero and prints the stream info
 * to stderr, so the "error" path here is the normal path — hence the catch that
 * reads stderr rather than rethrowing.
 */
export async function probeDuration(path: string): Promise<number> {
  const output = await run(ffmpegPath, ['-hide_banner', '-i', path])
    .then((r) => r.stderr)
    .catch((e: { stderr?: string }) => e.stderr ?? '');

  const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(output);
  // A clip we cannot measure is reported as 0 so callers drop it, rather than
  // defaulting to some plausible length and trimming against a guess.
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Whether a file carries an audio stream at all — b-roll frequently does not. */
export async function hasAudioStream(path: string): Promise<boolean> {
  const output = await run(ffmpegPath, ['-hide_banner', '-i', path])
    .then((r) => r.stderr)
    .catch((e: { stderr?: string }) => e.stderr ?? '');
  return /Stream #\d+:\d+.*: Audio:/.test(output);
}

/**
 * Whether the video is HDR, and therefore needs tone mapping on the way down to
 * an SDR reel.
 *
 * Every recent iPhone films HDR by default, so this is the common case rather
 * than an exotic one. Downconverting HDR without tone mapping does not fail —
 * it produces a washed-out, grey-looking reel with desaturated skies and flat
 * skin tones, and carries the HDR colour tags onto SDR pixels so players
 * misinterpret them a second time. Verified against a real iPhone clip: the
 * untonemapped render lost the blue in the sky entirely.
 *
 * Matched on the transfer characteristic (HLG or PQ) rather than the bt2020
 * primaries alone, because that is what actually determines whether the pixel
 * values need converting.
 */
export async function isHdr(path: string): Promise<boolean> {
  const output = await run(ffmpegPath, ['-hide_banner', '-i', path])
    .then((r) => r.stderr)
    .catch((e: { stderr?: string }) => e.stderr ?? '');
  return /Video:.*(arib-std-b67|smpte2084)/.test(output);
}
