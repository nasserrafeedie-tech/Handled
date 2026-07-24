import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptWord } from './captions';
import { hasAudioStream } from './probe';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

const run = promisify(execFile);

/**
 * Speech → word-level timings, for captions and for finding the good moments.
 *
 * A thin seam over one vendor behind an interface, for the same reason
 * image-gen.service.ts is: the model that is cheapest and best at this changes
 * faster than anything else in the stack, and the thing that must not leak into
 * the pipeline is which one we happen to be using.
 *
 * The important design decision here is that FAILURE IS NOT AN ERROR. Every
 * path that cannot produce words returns an empty transcript instead of
 * throwing:
 *
 *  • the clip has no audio track (b-roll of a latte pour — extremely common),
 *  • nobody speaks in it, so there are no words to time,
 *  • the API key is unset,
 *  • the network call fails, which it reliably does from the dev sandbox.
 *
 * An empty transcript costs the reel its captions and its smart trim points; it
 * falls back to the plain hard-cut edit. A thrown error would cost the customer
 * their reel entirely. Captions are the polish, not the product, and the
 * pipeline must degrade in that order.
 */

export interface ClipTranscript {
  words: TranscriptWord[];
  text: string;
}

/** Empty transcript — the shape returned by every degradation path. */
const EMPTY: ClipTranscript = { words: [], text: '' };

/**
 * Whisper's upload ceiling is 25MB. Extracted 16kHz mono speech audio runs
 * roughly 32kB/s, so this is ~13 minutes of clip — far beyond anything an owner
 * texts in, but a hard stop is cheaper than a rejected upload.
 */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

@Injectable()
export class TranscriptionService {
  private readonly log = new Logger(TranscriptionService.name);

  private static readonly ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

  /** Transcribe several clips, preserving order. One failure never sinks the rest. */
  async transcribeAll(paths: string[]): Promise<ClipTranscript[]> {
    return Promise.all(paths.map((p) => this.transcribe(p)));
  }

  async transcribe(clipPath: string): Promise<ClipTranscript> {
    if (!process.env.OPENAI_API_KEY) {
      this.log.warn('no OPENAI_API_KEY — reel will be cut without captions');
      return EMPTY;
    }

    // Checking for an audio stream first turns the single most common case —
    // silent b-roll — into a local check instead of a paid API round trip that
    // returns nothing.
    if (!(await hasAudioStream(clipPath).catch(() => false))) return EMPTY;

    const work = mkdtempSync(join(tmpdir(), 'transcribe-'));
    try {
      // 16kHz mono is what speech recognition consumes; sending the original
      // video would upload the whole 4K stream to transcribe its audio.
      const audio = join(work, 'audio.m4a');
      await run(ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', clipPath,
        // The first audio stream, explicitly. iPhone clips carry a second
        // spatial-audio track ffmpeg cannot decode; letting it pick means
        // transcription intermittently fails on footage that has clear speech.
        '-map', '0:a:0',
        '-vn', '-ac', '1', '-ar', '16000',
        '-c:a', 'aac', '-b:a', '64k',
        audio,
      ], { timeout: 2 * 60 * 1000 });

      if (statSync(audio).size > MAX_AUDIO_BYTES) {
        this.log.warn(`${clipPath}: audio too large to transcribe — skipping captions`);
        return EMPTY;
      }

      return await this.callWhisper(readFileSync(audio));
    } catch (err) {
      // Deliberately swallowed: see the class comment. The reel still ships.
      this.log.warn(
        `transcription failed for ${clipPath} — cutting without captions: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return EMPTY;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** The one place that talks to the transcription vendor. */
  private async callWhisper(audio: Buffer): Promise<ClipTranscript> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mp4' }), 'audio.m4a');
    form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1');
    // verbose_json is the only format that carries timings, and word
    // granularity is what captions are built from — segment-level timings would
    // put a whole sentence on screen at once, which is the static-block caption
    // the playbook explicitly rules out.
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const res = await fetch(TranscriptionService.ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(3 * 60 * 1000),
    });

    if (!res.ok) {
      throw new Error(
        `openai ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as {
      text?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
    };

    return normalizeWhisperResponse(data);
  }
}

/**
 * Pull clean timed words out of whatever the API returned.
 *
 * Split out and exported so the parsing can be tested without a network call —
 * the one part of transcription that is verifiable offline, and the part most
 * likely to break silently when the vendor changes its response shape.
 */
export function normalizeWhisperResponse(data: {
  text?: string;
  words?: Array<{ word?: string; start?: number; end?: number }>;
}): ClipTranscript {
  const words = (data.words ?? [])
    .filter(
      (w): w is { word: string; start: number; end: number } =>
        typeof w.word === 'string' &&
        typeof w.start === 'number' &&
        typeof w.end === 'number' &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.end > w.start,
    )
    .map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))
    .filter((w) => w.text.length > 0);

  return { words, text: data.text?.trim() ?? words.map((w) => w.text).join(' ') };
}
