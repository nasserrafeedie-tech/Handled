import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

const run = promisify(execFile);

/**
 * Reel assembly (§7, Growth+). Cuts the owner's real clips into a vertical
 * 1080×1920 reel: normalize → trim → hard cuts → hook text on the opening
 * seconds → branded end card. No AI video — real footage, professionally
 * assembled, which both looks more honest and IS more honest.
 *
 * Every choice here is downstream of the distribution playbook:
 *  - hard cuts, not crossfades (fades read corporate and cost watch time)
 *  - ≤3.5s per clip so the pace holds attention
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

  /** Longest any single clip may run, seconds. */
  private static readonly PER_CLIP = 3.5;
  /** End card hold, seconds. */
  private static readonly CARD_SECS = 2;

  /**
   * Assemble clips (+ optional PNG end card) into an mp4. Returns the encoded
   * bytes. Inputs are local file paths; callers own upload/storage.
   */
  async assemble(opts: {
    clipPaths: string[];
    hookText?: string;
    /** 1080×1080 brand card PNG from the graphics engine; padded to 9:16. */
    endCardPng?: Buffer;
    /** Brand accent for the hook text box, e.g. "#C9A227". */
    accentHex?: string;
    fontPath?: string;
  }): Promise<Buffer> {
    if (opts.clipPaths.length === 0) throw new Error('no clips to assemble');
    const work = mkdtempSync(join(tmpdir(), 'reel-'));
    try {
      // 1. Normalize every clip: 9:16 cover-crop, 30fps, capped length, uniform
      //    codec, mono-ish audio. Uniformity is what makes concat safe across
      //    iPhone HEVC / Android H.264 / rotated footage — ffmpeg's autorotate
      //    handles orientation metadata on decode.
      const segments: string[] = [];
      for (let i = 0; i < opts.clipPaths.length; i++) {
        const out = join(work, `seg${i}.mp4`);
        await this.ffmpeg([
          '-i', opts.clipPaths[i],
          '-t', String(ReelService.PER_CLIP),
          '-vf',
          'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2',
          '-shortest',
          out,
        ]);
        segments.push(out);
      }

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

      // 4. Hook text over the first 3 seconds (drawtext with a bundled brand
      //    font — the first frame has to earn the second one).
      const final = join(work, 'final.mp4');
      if (opts.hookText && opts.fontPath && existsSync(opts.fontPath)) {
        const text = opts.hookText.replace(/\\/g, '').replace(/'/g, '’').replace(/:/g, '\\:');
        const box = opts.accentHex ? `${opts.accentHex}@0.85` : 'black@0.55';
        await this.ffmpeg([
          '-i', joined,
          '-vf',
          `drawtext=fontfile='${opts.fontPath}':text='${text}':fontsize=64:fontcolor=white:box=1:boxcolor=${box}:boxborderw=28:x=(w-text_w)/2:y=h*0.16:enable='lte(t,3)'`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-c:a', 'copy',
          final,
        ]);
      } else {
        await run('/bin/cp', [joined, final]);
      }

      const { readFileSync } = await import('node:fs');
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
