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
    hookText?: string;
    /** 1080×1080 brand card PNG from the graphics engine; padded to 9:16. */
    endCardPng?: Buffer;
    /** Brand accent for the hook text box, e.g. "#C9A227". */
    accentHex?: string;
    fontPath?: string;
    /** Directory of bundled TTFs, so libass can resolve the caption font. */
    fontsDir?: string;
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

      const cuts = opts.edl?.segments.length
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
          ...(cut.start > 0 ? ['-ss', String(cut.start)] : []),
          '-i', cut.path,
          '-t', String(cut.duration),
          // Map explicitly. iPhone clips arrive carrying a second, 4-channel
          // spatial-audio track in a codec ffmpeg cannot decode, plus several
          // timed-metadata streams. Letting ffmpeg choose the "best" audio
          // stream means the reel's soundtrack depends on which track the
          // phone happened to write first. `?` keeps silent b-roll working.
          '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', videoFilter(cut.hdr),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
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
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
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

      // 4. Overlays: captions throughout, then the hook over the opening. Both
      //    go in ONE filter chain — running them as separate passes would
      //    re-encode the video twice and visibly soften it for no benefit.
      const filters: string[] = [];

      if (opts.captionsAss?.trim()) {
        // The ASS file carries every caption, so caption text never enters the
        // filtergraph — the same reasoning as the hook's textfile below, and
        // the reason a transcript full of quotes and percent signs is safe.
        const assFile = join(work, 'captions.ass');
        writeFileSync(assFile, opts.captionsAss, 'utf8');
        filters.push(
          `subtitles=filename='${esc(assFile)}'` +
            (opts.fontsDir && existsSync(opts.fontsDir)
              ? `:fontsdir='${esc(opts.fontsDir)}'`
              : ''),
        );
      }

      if (opts.hookText && opts.fontPath && existsSync(opts.fontPath)) {
        // The hook is read from a FILE, not interpolated into the filtergraph,
        // and expansion is switched off. Both matter:
        //
        //  • `expansion=none` stops drawtext running strftime over the text. A
        //    hook like "50% off this Friday" was silently rendering as NOTHING
        //    — the whole overlay vanished, no error, and the reel published
        //    without the one element that earns it distribution. Percent signs
        //    are unavoidable in promo copy, so this is not an edge case.
        //  • `textfile=` keeps quotes, colons and commas out of the filter
        //    string entirely, so no amount of escaping cleverness is needed for
        //    copy a language model wrote.
        const textFile = join(work, 'hook.txt');
        writeFileSync(textFile, opts.hookText, 'utf8');
        const box = opts.accentHex ? `${opts.accentHex}@0.85` : 'black@0.55';
        filters.push(
          `drawtext=fontfile='${esc(opts.fontPath)}':textfile='${esc(textFile)}'` +
            `:expansion=none:fontsize=64:fontcolor=white:box=1:boxcolor=${box}` +
            `:boxborderw=28:x=(w-text_w)/2:y=h*0.16:enable='lte(t,3)'`,
        );
      }

      const final = join(work, 'final.mp4');
      if (filters.length > 0) {
        await this.ffmpeg([
          '-i', joined,
          '-vf', filters.join(','),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
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

/** Fit any source to the 1080×1920 reel canvas at a uniform 30fps. */
const FIT_9_16 =
  'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p';

/**
 * Tone map HDR down to bt709 before fitting the frame.
 *
 * The chain is the standard one: linearise the signal, work in float so the
 * highlight roll-off has headroom, map with Hable (it protects highlights
 * better than the default clip, which blows out anything bright — a sunlit
 * window, a shop light), then re-tag as bt709. `desat=0` is deliberate:
 * ffmpeg's default desaturates highlights, and on skin tones under a bright
 * window that reads as a grey wash across someone's face.
 *
 * Applied ONLY to HDR sources. It roughly doubles encode time, so paying it on
 * the SDR clips that don't need it would cost every reel for the benefit of
 * some.
 */
const TONEMAP_SDR =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,' +
  'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

function videoFilter(hdr: boolean): string {
  return hdr ? `${TONEMAP_SDR},${FIT_9_16}` : FIT_9_16;
}

/**
 * Escape a path for use inside a filtergraph option. Backslashes, colons and
 * quotes all terminate or redirect filter parsing — on Windows-style or
 * colon-bearing temp paths an unescaped one silently points ffmpeg at a file
 * that does not exist, and the overlay just never appears.
 */
function esc(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
