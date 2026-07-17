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
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      return parseLlmJson(schema, await this.rawComplete(req));
    } catch (err) {
      if (!(err instanceof LlmJsonError)) throw err;
      this.log.warn(`LLM JSON malformed on ${req.tier}; retrying once`);
      const retry = await this.rawComplete({
        ...req,
        prompt: `${req.prompt}\n\nReturn ONLY valid minified JSON. No prose, no markdown fences.`,
      });
      return parseLlmJson(schema, retry);
    }
  }

  /**
   * The single seam that talks to Anthropic. Kept isolated so model routing and
   * prompt caching live in one place. Until ANTHROPIC_API_KEY is wired, this
   * throws clearly rather than silently returning fake content.
   */
  private async rawComplete(req: LlmJsonRequest): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY not configured — cannot run LLM step. ' +
          'Set it in .env to enable generation.',
      );
    }
    // Integration point: Anthropic Messages API. `cachedContext` goes in a
    // system block with cache_control:{type:'ephemeral'} so each customer's
    // brand_profile is cached across calls (§2 "~10x cheaper effective input").
    //
    //   messages.create({
    //     model: this.model(req.tier),
    //     max_tokens: req.maxTokens ?? 1024,
    //     system: [{ type:'text', text: req.cachedContext,
    //                cache_control:{ type:'ephemeral' } }],
    //     messages: [{ role:'user', content: req.prompt }],
    //   })
    throw new Error(
      `LLM call not yet implemented (model=${this.model(req.tier)}). ` +
        'Wire the Anthropic SDK in LlmService.rawComplete.',
    );
  }
}
