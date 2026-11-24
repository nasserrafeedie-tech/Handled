import { Injectable, Logger } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GraphicsService } from '../../graphics/graphics.service';
import { FPS, REEL_H, REEL_W } from './kit';
import type { ReelLook } from './look';
import type { AnimatedLayout } from './spec';
import { DURATION, frameAt, revealExpressions, type RevealPhotos } from './frames';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

const run = promisify(execFile);

export interface RenderStats {
  frames: number;
  /** Frames actually drawn; the rest repeated an identical earlier frame. */
  drawn: number;
  ms: number;
  bytes: number;
}

/**
 * Draws an animated reel frame by frame with the carousel engine (SVG through
 * resvg, with the bundled fonts) and encodes it with the ffmpeg the clip reels
 * already use. No browser, no new service, nothing per render to pay for.
 *
 * Frames go to ffmpeg as raw pixels over a pipe: no PNG encode and decode per
 * frame, and nothing written to disk but the finished file. A frame whose SVG
 * is identical to the one before it (the holds, where nothing moves) is not
 * drawn again, its pixels are just sent a second time.
 *
 * A before/after reveal splits the work: ffmpeg moves the two photos (the
 * push-in, the wipe) from the stills themselves, and resvg draws only what
 * goes on top (captions, labels, the wipe bar, the end card) on a clear
 * background, which ffmpeg lays over the photos. Drawing a full photo in
 * resvg costs about 160ms a frame, so this takes a reveal from about two
 * minutes to about the time of a promo.
 */
@Injectable()
export class AnimatedReelService {
  private readonly log = new Logger(AnimatedReelService.name);

  constructor(private readonly graphics: GraphicsService) {}

  /**
   * Crop a photo to the reel's frame (with a little room for the slow push-in)
   * and shrink it, so every frame decodes a small JPEG rather than a 12MP one.
   */
  async preparePhoto(bytes: Buffer): Promise<string> {
    const work = mkdtempSync(join(tmpdir(), 'anim-photo-'));
    try {
      const src = join(work, 'in');
      const out = join(work, 'out.jpg');
      writeFileSync(src, bytes);
      const w = Math.round(REEL_W * 1.08);
      const h = Math.round(REEL_H * 1.08);
      await run(ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', src,
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
        '-frames:v', '1', '-q:v', '4', out,
      ], { timeout: 60_000 });
      return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  async render(
    layout: AnimatedLayout,
    look: ReelLook,
    opts: { photos?: RevealPhotos; seed?: number } = {},
  ): Promise<{ mp4: Buffer; stats: RenderStats }> {
    if (layout.kind === 'before_after' && !opts.photos) {
      throw new Error('a before-and-after reel needs both photos');
    }
    const secs = DURATION[layout.kind];
    const frames = Math.round(secs * FPS);
    const work = mkdtempSync(join(tmpdir(), 'anim-'));
    const out = join(work, 'reel.mp4');
    const started = Date.now();
    let drawn = 0;
    try {
      const reveal = layout.kind === 'before_after' ? this.revealInputs(work, opts.photos!, secs) : null;
      const ff = spawn(ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${REEL_W}x${REEL_H}`, '-framerate', String(FPS), '-i', '-',
        ...(reveal?.inputs ?? []),
        // A silent track: Instagram and TikTok treat a reel with no audio
        // stream as broken on some players, and the clip reels carry one too.
        '-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=r=44100:cl=stereo',
        ...(reveal ? ['-filter_complex', reveal.graph, '-map', '[v]', '-map', '3:a'] : ['-map', '0:v', '-map', '1:a']),
        '-shortest',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-threads', '2', '-x264-params', 'rc-lookahead=10:sync-lookahead=0:threads=2',
        '-c:a', 'aac', '-movflags', '+faststart', out,
      ], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      ff.stderr.on('data', (d) => (stderr += String(d)));
      const closed = new Promise<number>((resolve, reject) => {
        ff.on('error', reject);
        ff.on('close', (code) => resolve(code ?? 1));
      });
      let pipeError: Error | undefined;
      ff.stdin.on('error', (e) => (pipeError = e));

      let lastSvg = '';
      let lastPixels: Buffer | undefined;
      for (let i = 0; i < frames; i++) {
        if (pipeError) break;
        const svg = frameAt(layout, look, i / FPS, reveal ? { ...opts, photos: null } : opts);
        if (svg !== lastSvg || !lastPixels) {
          const img = this.graphics.rasterize(svg, REEL_W);
          if (img.width !== REEL_W || img.height !== REEL_H) {
            throw new Error(`frame came out ${img.width}x${img.height}`);
          }
          lastPixels = Buffer.from(img.pixels.buffer, img.pixels.byteOffset, img.pixels.byteLength);
          lastSvg = svg;
          drawn++;
        }
        if (!ff.stdin.write(lastPixels)) {
          await new Promise<void>((r) => ff.stdin.once('drain', () => r()));
        }
      }
      ff.stdin.end();
      const code = await closed;
      if (code !== 0 || pipeError) {
        throw new Error(`ffmpeg: ${(stderr || pipeError?.message || `exit ${code}`).slice(0, 400)}`);
      }
      const mp4 = readFileSync(out);
      const stats = { frames, drawn, ms: Date.now() - started, bytes: mp4.length };
      this.log.log(`animated ${layout.kind} reel: ${drawn}/${frames} frames drawn in ${stats.ms}ms`);
      return { mp4, stats };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /**
   * The photo layer of a reveal, for ffmpeg: the two stills written to disk,
   * looped for the length of the reel, each scaled frame by frame by its zoom
   * curve and cropped to the frame. The wipe shows the after photo left of a
   * moving edge: the before photo is cut at that edge (padded, then cropped
   * from the edge) and laid over the after photo starting there. The overlay
   * that resvg draws (input 0, premultiplied RGBA) goes on top.
   */
  private revealInputs(work: string, photos: RevealPhotos, secs: number): { inputs: string[]; graph: string } {
    const file = (name: string, uri: string) => {
      const path = join(work, name);
      writeFileSync(path, Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
      return path;
    };
    const before = file('before.jpg', photos.before);
    const after = file('after.jpg', photos.after);
    const still = (path: string) => ['-loop', '1', '-framerate', String(FPS), '-t', String(secs), '-i', path];
    // Quoted and with commas escaped, so the filtergraph reads each expression whole.
    const q = (expr: string) => `'${expr.replace(/,/g, '\\,')}'`;
    const e = revealExpressions();
    const edge = q(`${REEL_W}*${e.wipe}`);
    const pw = Math.round(REEL_W * 1.08);
    const ph = Math.round(REEL_H * 1.08);
    const zoomed = (zoom: string) =>
      `scale=w=${q(`2*trunc(${pw}*${zoom}/2)`)}:h=${q(`2*trunc(${ph}*${zoom}/2)`)}:eval=frame,crop=${REEL_W}:${REEL_H}`;
    const graph = [
      `[1:v]${zoomed(e.beforeZoom)},pad=${REEL_W * 2}:${REEL_H}:0:0,crop=${REEL_W}:${REEL_H}:x=${edge}:y=0[b]`,
      `[2:v]${zoomed(e.afterZoom)}[a]`,
      `[a][b]overlay=x=${edge}:y=0:eval=frame[ph]`,
      `[ph][0:v]overlay=alpha=premultiplied:format=auto,format=yuv420p[v]`,
    ].join(';');
    return { inputs: [...still(before), ...still(after)], graph };
  }
}
