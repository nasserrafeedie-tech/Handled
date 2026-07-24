import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { ReelEdl, clampEdl, fallbackEdl, MAX_REEL_SECS } from './edl';
import type { ClipTranscript } from './transcription.service';

/**
 * The LLM as video editor.
 *
 * Handled already runs a model that knows the brand and the playbook, so the
 * editorial judgement — which moment is the payoff, where a sentence starts,
 * what the hook should say — costs one cheap call rather than a new vendor.
 * What comes back is an edit PLAN (see edl.ts), never a video.
 *
 * The craft rules below are `video-playbook.md` compressed to the decisions the
 * model actually has to make. They are guidance the model applies; the hard
 * limits are enforced afterwards by clampEdl, because a prompt is a request and
 * a clamp is a guarantee.
 */

/** The editing rules from video-playbook.md, in the model's terms. */
const CRAFT_RULES = [
  'You are editing a vertical short-form reel for a local small business.',
  'Rules, in priority order:',
  '1. HOOK: the reel must open on the payoff — the finished result, the reveal,',
  '   the most visually interesting moment. Never open on setup, a slow pan, or',
  '   someone saying hello. Viewers lost in the first 3 seconds never come back.',
  '2. PACE: cut every 2-3 seconds. Cut out dead air, silence, filler and false',
  '   starts. Fast pace correlates with people finishing the video.',
  `3. LENGTH: aim for 21-34 seconds total, and never exceed ${MAX_REEL_SECS}.`,
  '   Shorter is fine for a single satisfying moment. Every second must earn',
  '   its place.',
  '4. ORDER: you may reorder clips freely. Best moment first, second-best last.',
  '5. SPEECH: prefer cutting on sentence boundaries from the transcript, so',
  '   captions read as complete thoughts rather than fragments.',
].join('\n');

@Injectable()
export class EdlService {
  private readonly log = new Logger(EdlService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Decide the edit. Always returns a usable EDL.
   *
   * Falls back to the plain in-order cut whenever the model cannot help: no
   * speech anywhere in the footage (nothing to reason about), a call that
   * fails, or a plan that clamps down to nothing. Reels must always produce
   * output — see the same commitment in transcription.service.ts.
   */
  async decide(opts: {
    clipDurations: number[];
    transcripts: ClipTranscript[];
    defaultHook: string;
    brandContext: string;
    customerId?: string;
  }): Promise<ReelEdl> {
    const fallback = fallbackEdl(opts.clipDurations, opts.defaultHook);

    // With no words anywhere there is no transcript to pick moments from, and
    // the model would be guessing at timings it cannot observe. The in-order
    // cut is the honest answer.
    const anySpeech = opts.transcripts.some((t) => t.words.length > 0);
    if (!anySpeech) {
      this.log.log('no speech in any clip — using the plain in-order cut');
      return fallback;
    }

    try {
      const edl = await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext: opts.brandContext,
          customerId: opts.customerId,
          prompt: [
            CRAFT_RULES,
            '',
            'The available clips, with their transcripts:',
            this.describeClips(opts.clipDurations, opts.transcripts),
            '',
            'Return JSON only:',
            '{"segments":[{"clip_index":number,"start":number,"end":number,"reason":string}],',
            ' "hook":string}',
            '',
            'start/end are seconds within that clip and must lie inside its',
            'duration. hook is the on-screen text for the opening seconds: max',
            '8 words, a bold claim or a question, no hashtags, no emoji.',
          ].join('\n'),
          maxTokens: 1200,
        },
        ReelEdl,
      );

      const clamped = clampEdl(edl, opts.clipDurations);
      if (clamped.segments.length === 0) {
        this.log.warn('model EDL had no usable segments after clamping — falling back');
        return fallback;
      }
      this.log.log(
        `edit: ${clamped.segments.length} segment(s) from ${opts.clipDurations.length} clip(s)`,
      );
      return clamped;
    } catch (err) {
      this.log.warn(
        `EDL generation failed — using the plain cut: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }

  /**
   * Describe the footage to the model. Timings are included per word-group
   * because the model's whole job is choosing in/out points — a bare transcript
   * with no times would force it to invent them.
   */
  private describeClips(durations: number[], transcripts: ClipTranscript[]): string {
    return durations
      .map((duration, i) => {
        const words = transcripts[i]?.words ?? [];
        if (words.length === 0) {
          return `clip ${i}: ${duration.toFixed(1)}s, no speech (b-roll — use it for visual variety)`;
        }
        // Group into ~5-word chunks with a start time: enough resolution to cut
        // on, without spending the context window on one line per word.
        const chunks: string[] = [];
        for (let w = 0; w < words.length; w += 5) {
          const group = words.slice(w, w + 5);
          chunks.push(`[${group[0].start.toFixed(1)}s] ${group.map((g) => g.text).join(' ')}`);
        }
        return `clip ${i}: ${duration.toFixed(1)}s\n  ${chunks.join('\n  ')}`;
      })
      .join('\n');
  }
}
