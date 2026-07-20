import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { parseLlmJson, LlmJsonError } from '@smm/contracts';

export type LlmTier = 'bulk' | 'voice';

export interface LlmJsonRequest {
  /** Which model tier (§2 routing): bulk = Haiku 4.5, voice = Sonnet 5. */
  tier: LlmTier;
  /** Stable per-customer context (the brand_profile) — sent as a cacheable
   *  system block so repeated calls hit the prompt cache (§2, §12). */
  cachedContext: string;
  /** The variable instruction for this specific call. */
  prompt: string;
  maxTokens?: number;
}

/**
 * Thin Claude wrapper. Two responsibilities that matter to the rest of the
 * system: (1) model routing per §2, (2) enforce "JSON only, retry once on
 * malformed output" (§4/§12) via `completeJson`.
 *
 * The actual Anthropic SDK call is isolated in `rawComplete` so it can be
 * swapped for a fallback model (§2) without touching callers. Prompt caching is
 * applied by marking `cachedContext` with cache_control on the system block.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);

  private model(tier: LlmTier): string {
    return tier === 'voice'
      ? process.env.LLM_MODEL_VOICE ?? 'claude-sonnet-5'
      : process.env.LLM_MODEL_BULK ?? 'claude-haiku-4-5';
  }

  /**
   * Call the model and validate the JSON result against `schema`. On malformed
   * output, retry exactly once with a corrective nudge, then give up (§12).
   */
  async completeJson<T>(
    req: LlmJsonRequest,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    try {
      return parseLlmJson(schema, await this.rawComplete(req));
    } catch (err) {
      if (!(err instanceof LlmJsonError)) throw err;
      this.log.warn(`LLM JSON malformed on ${req.tier}; retrying once`);
      // Tell the model exactly what was wrong with its first try — a bare
      // "return valid JSON" nudge makes it repeat the same shape mistake.
      const retry = await this.rawComplete({
        ...req,
        prompt: `${req.prompt}\n\nYour previous reply was rejected: ${err.message}. Return ONLY valid minified JSON in exactly the requested shape — no prose, no markdown fences, every field the exact type asked for.`,
      });
      return parseLlmJson(schema, retry);
    }
  }

  /**
   * The single seam that talks to Anthropic. Kept isolated so model routing and
   * prompt caching live in one place.
   *
   * Offline mode: if there is no ANTHROPIC_API_KEY (or LLM_FAKE=1), we return
   * canned, schema-valid JSON instead of calling the API. This lets the whole
   * app be tested end-to-end for free — swap in the key to get real content.
   */
  private async rawComplete(req: LlmJsonRequest): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const fake = process.env.LLM_FAKE === '1' || !apiKey;
    if (fake) {
      this.log.warn(
        `LLM offline mode (no ANTHROPIC_API_KEY) — returning canned ${req.tier} content`,
      );
      return this.fakeComplete(req);
    }

    // Anthropic Messages API via plain fetch (no SDK dependency). The
    // brand_profile goes in a system block with cache_control:{type:'ephemeral'}
    // so it's cached across calls per customer (§2 "~10x cheaper effective
    // input"). Flips on the moment ANTHROPIC_API_KEY is set.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model(req.tier),
        max_tokens: req.maxTokens ?? 1024,
        system: [
          {
            type: 'text',
            text: req.cachedContext,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: req.prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Anthropic API ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    if (!text) {
      throw new Error('Anthropic API returned no text content');
    }
    return text;
  }

  /**
   * Deterministic offline stand-in for the model. Detects which kind of output
   * the caller wants from cues in the prompt and returns matching JSON. Good
   * enough to exercise the full pipeline (moderation, guardrails, scheduling)
   * without spending a cent.
   */
  private fakeComplete(req: LlmJsonRequest): string {
    // PLAN_WEEK — asks for a "slots" array.
    if (/slots/i.test(req.prompt)) {
      const count = Number(/plan\s+(\d+)\s+posts/i.exec(req.prompt)?.[1] ?? 5);
      // Strip trailing punctuation so "…starting 2026-07-20." can't produce
      // an Invalid Date (which would crash toISOString below).
      const startMatch = /week starting (\S+)/i
        .exec(req.prompt)?.[1]
        ?.replace(/[.,;]+$/, '');
      let start = startMatch ? new Date(startMatch) : new Date();
      if (Number.isNaN(start.getTime())) start = new Date();
      const archetypes = [
        'were_open',
        'behind_the_scenes',
        'educational_tip',
        'product_spotlight',
        'testimonial',
        'seasonal',
        'promo',
      ];
      const slots = Array.from({ length: Math.max(1, count) }, (_, i) => {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + i);
        return {
          date: d.toISOString().slice(0, 10),
          archetype: archetypes[i % archetypes.length],
          platform: 'instagram',
          best_time: ['09:00', '12:30', '17:00'][i % 3],
          needs_asset: i % 3 === 0,
          shot_list:
            i % 3 === 0 ? 'A bright, natural photo of the shop or product.' : undefined,
        };
      });
      return JSON.stringify({ slots });
    }

    // DRAFT_POST / REGENERATE_POST — asks for a caption + hashtags.
    return JSON.stringify({
      caption:
        'Come see what we have in store today — made with care, just for you. ' +
        'Stop by and say hello! 👋',
      hashtags: ['smallbusiness', 'shoplocal', 'supportlocal', 'community'],
    });
  }
}
