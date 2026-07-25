import {
  Controller,
  Headers,
  Logger,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../common/storage.service';
import { detectMedia } from '../common/media-type';
import { assertAdmin } from './admin-auth';
import { ReelService } from '../operator/video/reel.service';
import { TranscriptionService } from '../operator/video/transcription.service';
import { EdlService } from '../operator/video/edl.service';
import { probeDuration, isHdr } from '../operator/video/probe';
import { mapWordsToTimeline, edlDuration } from '../operator/video/edl';
import { captionsToAss, groupWordsIntoLines } from '../operator/video/captions';

/**
 * Reel diagnostics — run the video pipeline on a clip and report every stage.
 *
 * This exists because of a specific failure: the first end-to-end render came
 * back with captions that did not match the speech and cuts that made no
 * editorial sense, and there was no way to tell which stage was at fault.
 * Transcription, the model's edit, the timeline remap and the burn-in can each
 * produce that same symptom, and the finished MP4 looks identical whichever one
 * is broken.
 *
 * So this returns the intermediate results — what was heard, what was chosen
 * and why, where each caption landed — rather than only the video. Quality here
 * is a taste problem, and taste cannot be debugged from a black box.
 *
 * Behind ADMIN_TOKEN and 404s without it, matching the rest of /admin. Nothing
 * is written to a customer's account: no MediaAsset, no Post, no text message.
 * It renders, stores the file, and reports.
 */
@Controller('admin/reel-lab')
export class ReelLabController {
  private readonly log = new Logger(ReelLabController.name);

  constructor(
    private readonly reel: ReelService,
    private readonly transcription: TranscriptionService,
    private readonly edl: EdlService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 200 * 1024 * 1024, files: 6 } }))
  async run(
    @Headers('x-admin-token') token: string | undefined,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }> | undefined,
    @Query('hook') hook?: string,
  ) {
    assertAdmin(token);
    if (!files?.length) return { error: 'no files' };

    const work = mkdtempSync(join(tmpdir(), 'reel-lab-'));
    const started = Date.now();
    try {
      // Trust the bytes, not the filename — same rule as /uploads, since this
      // writes a file and then hands ffmpeg the path.
      const clips: string[] = [];
      for (const f of files) {
        const detected = detectMedia(f.buffer);
        if (detected?.kind !== 'video') {
          return { error: 'not_video', detail: `${f.originalname} is not a video file` };
        }
        const p = join(work, `clip${clips.length}.${detected.ext}`);
        writeFileSync(p, f.buffer);
        clips.push(p);
      }

      // ---- stage 1: probe -------------------------------------------------
      const durations = await Promise.all(clips.map((c) => probeDuration(c)));
      const hdr = await Promise.all(clips.map((c) => isHdr(c)));

      // ---- stage 2: transcribe --------------------------------------------
      const tStart = Date.now();
      const transcripts = await this.transcription.transcribeAll(clips);
      const transcribeMs = Date.now() - tStart;

      // ---- stage 3: the model's edit --------------------------------------
      const eStart = Date.now();
      const decision = await this.edl.decide({
        clipDurations: durations,
        transcripts,
        defaultHook: hook ?? 'Watch this',
        brandContext: '',
      });
      const edlMs = Date.now() - eStart;

      // ---- stage 4: captions on the finished timeline ----------------------
      const timeline = mapWordsToTimeline(decision, transcripts.map((t) => t.words));
      const lines = groupWordsIntoLines(timeline);
      const ass = captionsToAss(timeline, {
        accentHex: '#C9A227',
        brandStyle: 'bold',
        hookText: decision.hook,
      });

      // ---- stage 5: render -------------------------------------------------
      const rStart = Date.now();
      const mp4 = await this.reel.assemble({
        clipPaths: clips,
        edl: decision,
        captionsAss: ass,
        fontsDir: join(__dirname, '..', 'operator', 'graphics', 'fonts'),
      });
      const renderMs = Date.now() - rStart;

      const key = `reel-lab/${randomUUID()}.mp4`;
      await this.storage.put(key, mp4, 'video/mp4');

      return {
        video_url: this.storage.publicUrl(key),
        clips: clips.map((_, i) => ({
          index: i,
          seconds: Number(durations[i].toFixed(2)),
          hdr: hdr[i],
          // The full transcript, so a caption mismatch can be traced to
          // whether the words were heard wrong or placed wrong.
          heard: transcripts[i].text,
          word_count: transcripts[i].words.length,
        })),
        edit: {
          hook: decision.hook,
          total_seconds: Number(edlDuration(decision).toFixed(2)),
          // reason is the model's own justification per cut. When an edit makes
          // no sense this is the difference between fixing the prompt and
          // guessing at it.
          segments: decision.segments.map((s) => ({
            clip: s.clip_index,
            from: Number(s.start.toFixed(2)),
            to: Number(s.end.toFixed(2)),
            reason: s.reason ?? '(none given)',
          })),
        },
        captions: lines.map((l) => ({
          at: `${l.start.toFixed(2)}–${l.end.toFixed(2)}s`,
          text: l.text,
        })),
        timings_ms: {
          transcribe: transcribeMs,
          decide_edit: edlMs,
          render: renderMs,
          total: Date.now() - started,
        },
        // Named so a silent degradation is visible rather than inferred: both
        // false means the reel fell back to the plain in-order cut.
        used_transcription: transcripts.some((t) => t.words.length > 0),
        used_model_edit: (decision.segments[0]?.reason ?? '') !== '',
      };
    } catch (err) {
      this.log.error(`reel-lab failed: ${err instanceof Error ? err.stack : String(err)}`);
      return { error: 'failed', detail: err instanceof Error ? err.message : String(err) };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}
