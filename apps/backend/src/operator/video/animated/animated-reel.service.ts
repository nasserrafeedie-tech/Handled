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
import { DURATION, frameAt, type RevealPhotos } from './frames';
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
      const ff = spawn(ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${REEL_W}x${REEL_H}`, '-framerate', String(FPS), '-i', '-',
        // A silent track: Instagram and TikTok treat a reel with no audio
        // stream as broken on some players, and the clip reels carry one too.
        '-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=r=44100:cl=stereo',
        '-map', '0:v', '-map', '1:a', '-shortest',
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
        const svg = frameAt(layout, look, i / FPS, opts);
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
}
