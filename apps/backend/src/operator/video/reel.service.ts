import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReelEdl } from './edl';
import { isHdr } from './probe';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

const run = promisify(execFile);

/**
 * Reel assembly (§7, Growth+). Cuts the owner's real clips into a vertical
 * 1080×1920 reel: normalize → trim → hard cuts → captions burned in throughout
 * → hook text on the opening seconds → branded end card. No AI video — real
 * footage, professionally assembled, which both looks more honest and IS more
 * honest.
 *
 * Every choice here is downstream of the distribution playbook:
 *  - hard cuts, not crossfades (fades read corporate and cost watch time)
 *  - the edit follows an EDL when one is supplied, so trims land on the good
 *    moment instead of blindly taking each clip's opening seconds
 *  - captions run the whole way through — about a third of the audience watches
 *    on mute, and the platforms index caption text for search
 *  - the hook text sits on the first 3 seconds — the window Instagram uses
 *    to decide whether the reel gets distribution
 *  - natural clip audio is kept: the espresso machine beats stock music, and
 *    licensed tracks are a legal minefield we deliberately stay out of.
 *
 * Runs the bundled ffmpeg-static binary — same package ships Linux builds, so
 * this works identically on Render. Encoding happens off the request path.
 */
@Injectable()
export class ReelService {
  private readonly log = new Logger(ReelService.name);

  /** Longest any single clip may run when there is no EDL to trim by. */
  private static readonly PER_CLIP = 3.5;
  /** End card hold, seconds. */
  private static readonly CARD_SECS = 2;

  /**
   * Assemble clips (+ optional PNG end card) into an mp4. Returns the encoded
   * bytes. Inputs are local file paths; callers own upload/storage.
   */
  async assemble(opts: {
    clipPaths: string[];
    /**
     * The edit to cut. Without one, every clip is used in order at its opening
     * PER_CLIP seconds — the original behaviour, kept because it is also the
     * fallback whenever transcription or the model editor is unavailable.
     */
    edl?: ReelEdl;
    /**
     * Captions as an ASS subtitle file (see captions.ts), timed against the
     * finished edit's timeline. Burned in, because captions that depend on the
     * player being willing to render a sidecar are captions most viewers on
     * Instagram will never see.
     */
    captionsAss?: string;
    /** 1080×1080 brand card PNG from the graphics engine; padded to 9:16. */
    endCardPng?: Buffer;
    /** Directory of bundled TTFs, so libass can resolve the caption font. */
    fontsDir?: string;
    /**
     * A dynamic cold-open (#1): the most visually active window found in the
     * footage, prepended as a short SILENT lead so the reel opens on motion, not
     * a static talking head. Muted on purpose — with no music yet, a fragment of
     * mid-sentence audio at the very top would be jarring; the picture carries it.
     * The caption/hook timeline is shifted by `duration` to compensate (see the
     * handler). Omitted when the footage has no standout moment.
     */
    coldOpen?: { clipIndex: number; start: number; duration: number };
  }): Promise<Buffer> {
    if (opts.clipPaths.length === 0) throw new Error('no clips to assemble');
    const work = mkdtempSync(join(tmpdir(), 'reel-'));
    try {
      // 1. Normalize every segment: 9:16 cover-crop, 30fps, capped length,
      //    uniform codec, mono-ish audio. Uniformity is what makes concat safe
      //    across iPhone HEVC / Android H.264 / rotated footage — ffmpeg's
      //    autorotate handles orientation metadata on decode.
      // Probe each source once, not once per segment: two cuts from the same
      // clip would otherwise pay for the same HDR detection twice.
      const hdrByPath = new Map<string, boolean>();
      for (const p of new Set(opts.clipPaths)) {
        hdrByPath.set(p, await isHdr(p).catch(() => false));
      }

      const cuts: Array<{
        path: string;
        start: number;
        duration: number;
        hdr: boolean;
        mute?: boolean;
      }> = opts.edl?.segments.length
        ? opts.edl.segments.map((s) => ({
            path: opts.clipPaths[s.clip_index],
            start: s.start,
            duration: s.end - s.start,
            hdr: hdrByPath.get(opts.clipPaths[s.clip_index]) ?? false,
          }))
        : opts.clipPaths.map((path) => ({
            path,
            start: 0,
            duration: ReelService.PER_CLIP,
            hdr: hdrByPath.get(path) ?? false,
          }));

      // Prepend the dynamic cold-open as a muted lead segment, if one was found
      // and points at a real clip.
      const co = opts.coldOpen;
      const coPath = co ? opts.clipPaths[co.clipIndex] : undefined;
      if (co && coPath) {
        cuts.unshift({
          path: coPath,
          start: co.start,
          duration: co.duration,
          hdr: hdrByPath.get(coPath) ?? false,
          mute: true,
        });
      }

      const segments: string[] = [];
      for (let i = 0; i < cuts.length; i++) {
        const cut = cuts[i];
        // A segment whose clip index fell outside the supplied paths would make
        // ffmpeg read `undefined` as a filename; skipping keeps the reel alive.
        if (!cut.path) continue;
        const out = join(work, `seg${i}.mp4`);
        await this.ffmpeg([
          // -ss BEFORE -i seeks by keyframe and is dramatically faster; the
          // re-encode that follows makes the cut frame-accurate anyway.
          // Cap DECODE threads. ffmpeg defaults to one thread per core, and
          // each holds its own reference frames — on 4K that alone took peak
          // memory from ~520MB to 1.46GB and OOM-killed a 512MB container,
          // taking the whole backend down with it. The core count of the box
          // has nothing to do with how much memory it has.
          '-threads', '2',
          ...(cut.start > 0 ? ['-ss', String(cut.start)] : []),
          '-i', cut.path,
          // A muted cold-open takes its audio from a silence source, not the
          // clip — a mid-sentence fragment at the very top would be jarring, and
          // a silent track keeps the concat's audio streams aligned (same reason
          // the end card uses anullsrc).
          ...(cut.mute
            ? ['-f', 'lavfi', '-t', String(cut.duration), '-i', 'anullsrc=r=44100:cl=stereo']
            : []),
          '-t', String(cut.duration),
          // Map explicitly. iPhone clips arrive carrying a second, 4-channel
          // spatial-audio track in a codec ffmpeg cannot decode, plus several
          // timed-metadata streams. Letting ffmpeg choose the "best" audio
          // stream means the reel's soundtrack depends on which track the
          // phone happened to write first. `?` keeps silent b-roll working.
          '-map', '0:v:0', ...(cut.mute ? ['-map', '1:a:0'] : ['-map', '0:a:0?']),
          '-vf', videoFilter(cut.hdr),
          ...X264_LOW_MEMORY,
          '-c:a', 'aac', '-ar', '44100', '-ac', '2',
          '-shortest',
          out,
        ]);
        segments.push(out);
      }
      if (segments.length === 0) throw new Error('no usable segments to assemble');

      // 2. End card: brand PNG (square) letterboxed onto the brand-dark frame,
      //    with silent audio so the concat's audio streams stay aligned.
      if (opts.endCardPng) {
        const cardPng = join(work, 'card.png');
        writeFileSync(cardPng, opts.endCardPng);
        const out = join(work, `seg${segments.length}.mp4`);
        await this.ffmpeg([
          '-loop', '1', '-t', String(ReelService.CARD_SECS), '-i', cardPng,
          '-f', 'lavfi', '-t', String(ReelService.CARD_SECS), '-i', 'anullsrc=r=44100:cl=stereo',
          '-vf',
          'scale=1080:1080,pad=1080:1920:0:420:black,fps=30,setsar=1,format=yuv420p',
          ...X264_LOW_MEMORY,
          '-c:a', 'aac', '-ar', '44100', '-ac', '2',
          '-shortest',
          out,
        ]);
        segments.push(out);
      }

      // 3. Concat with hard cuts.
      const listFile = join(work, 'list.txt');
      writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));
      const joined = join(work, 'joined.mp4');
      await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);

      // 4. Overlays: captions and the hook, both burned in from ONE ASS file
      //    through libass.
      //
      //    The hook used to be a separate drawtext pass. That filter is absent
      //    from the Linux ffmpeg-static build Render runs — the render failed
      //    with "No such filter: 'drawtext'", so it never worked in production
      //    at all. libass IS present, and the caption path already proved it,
      //    so the hook is now an event in the same subtitle file (see
      //    captions.ts). One pass, one text engine, and no drawtext dependency.
      const final = join(work, 'final.mp4');
      if (opts.captionsAss?.trim()) {
        // The ASS file carries every overlay, so no overlay text ever enters
        // the filtergraph — which is why a transcript or a hook full of quotes
        // and percent signs is safe without any escaping.
        const assFile = join(work, 'captions.ass');
        writeFileSync(assFile, opts.captionsAss, 'utf8');
        const subtitles =
          `subtitles=filename='${esc(assFile)}'` +
          (opts.fontsDir && existsSync(opts.fontsDir) ? `:fontsdir='${esc(opts.fontsDir)}'` : '');
        await this.ffmpeg([
          '-i', joined,
          '-vf', subtitles,
          ...X264_LOW_MEMORY,
          '-c:a', 'copy',
          final,
        ]);
      } else {
        await run('/bin/cp', [joined, final]);
      }

      return readFileSync(final);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  private async ffmpeg(args: string[]): Promise<void> {
    try {
      await run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
        timeout: 5 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      this.log.error(`ffmpeg failed: ${e.stderr ?? e.message}`);
      throw new Error(`ffmpeg: ${(e.stderr ?? e.message ?? 'unknown').slice(0, 400)}`);
    }
  }
}

/**
 * Fit any source to the 1080×1920 reel canvas at a uniform 30fps.
 *
 * Kept separate from the pixel-format conversion so the HDR path can slot tone
 * mapping in between — see videoFilter.
 */
const FIT_9_16 =
  'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1';

/**
 * Tone map HDR down to bt709.
 *
 * The chain is the standard one: linearise the signal, work in float so the
 * highlight roll-off has headroom, map with Hable (it protects highlights
 * better than the default clip, which blows out anything bright — a sunlit
 * window, a shop light), then re-tag as bt709. `desat=0` is deliberate:
 * ffmpeg's default desaturates highlights, and on skin tones under a bright
 * window that reads as a grey wash across someone's face.
 */
const TONEMAP_SDR =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,' +
  'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

/**
 * Scale FIRST, then tone map. The order is the whole point.
 *
 * Tone mapping runs in 32-bit float, so a frame costs width×height×3×4 bytes
 * while it is in the filter. At a 4K source that is ~99MB per frame and the
 * filter holds several at once — which is exactly how this pipeline exhausted
 * a 512MB container and took the whole backend down with it. Downscaling to
 * the 1080×1920 delivery size first drops the same frame to ~25MB, a 4×
 * saving, for no visible difference: the reel is 1080 wide either way, so the
 * detail thrown away by tone mapping at full resolution was going to be
 * discarded by the scaler regardless.
 *
 * Tone mapping is applied ONLY to HDR sources — it is the expensive half of
 * the chain, and SDR clips must not pay for it.
 */
function videoFilter(hdr: boolean): string {
  return hdr
    ? `${FIT_9_16},${TONEMAP_SDR},format=yuv420p`
    : `${FIT_9_16},format=yuv420p`;
}

/**
 * Encoder settings tuned for a small container rather than for speed.
 *
 * x264 looks ahead 40 frames by default to make better rate decisions, holding
 * every one of them in memory; at 1080×1920 that alone is a few hundred MB.
 * Ten frames is plenty for footage cut into 2–4 second segments, and capping
 * the thread count stops x264 allocating a full frame buffer per core on a
 * machine whose core count has nothing to do with its memory.
 */
const X264_LOW_MEMORY = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
  '-threads', '2',
  '-x264-params', 'rc-lookahead=10:sync-lookahead=0:threads=2',
];

/**
 * Escape a path for use inside a filtergraph option. Backslashes, colons and
 * quotes all terminate or redirect filter parsing — on Windows-style or
 * colon-bearing temp paths an unescaped one silently points ffmpeg at a file
 * that does not exist, and the overlay just never appears.
 */
function esc(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
