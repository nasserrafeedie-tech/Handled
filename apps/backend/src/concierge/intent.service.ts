import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../operator/llm/llm.service';

/**
 * What the owner meant by a steady-state text (§6). Onboarding and the kill
 * switch are handled deterministically before this ever runs; this is the
 * everyday loop — someone glancing at a draft between customers.
 *
 *   approve  "yes" / "looks good" / "send it" / 👍
 *   revise   "make it warmer" / "swap the photo" / "shorter please"
 *   cancel   "skip this one" / "don't post that"
 *   question "when does it go out?" / "how many did we post?"
 *   other    anything else — we acknowledge rather than guess
 */
export type OwnerIntent = 'approve' | 'revise' | 'cancel' | 'question' | 'other';

export interface IntentResult {
  intent: OwnerIntent;
  /** For `revise`: what the owner wants changed, in their own words. */
  feedback?: string;
}

const LlmIntent = z
  .object({
    intent: z.enum(['approve', 'revise', 'cancel', 'question', 'other']),
    feedback: z.string().max(1000).optional(),
  })
  .strict();

/* Ordered most- to least-specific: a cancel often contains revise-ish words
   ("don't make it longer"), so cancel is tested before revise. */
const CANCEL_RE =
  /\b(skip (?:it|this|that)|cancel (?:it|this|that|the post)|don'?t post|do not post|scrap (?:it|this|that)|kill (?:it|this)|not this one|never ?mind|forget (?:it|this))\b/i;
/* Real approvals are rarely a bare "yes" — they trail off into praise
   ("yes looks great", "perfect, thanks!"). So we match on how the message
   *opens*, having already ruled out cancels and edit requests above. */
/* Word alternatives need a trailing \b so "ok" doesn't match "okra"; emoji
   must NOT have one, since \b never matches after a non-word character. */
const APPROVE_RE =
  /^\s*(?:(?:yes|yep|yeah|yup|ya|sure|ok|okay|kk?|perfect|great|awesome|beautiful|lovely|nice|love it|looks (?:good|great|perfect|awesome|amazing)|lgtm|sounds (?:good|great)|send it|post it|ship it|publish it|go ahead|go for it|do it|approved?)\b|👍|👌|🔥|✅|💯|🙌|❤️|😍)/i;
const REVISE_RE =
  /\b(change|edit|revise|reword|rewrite|redo|tweak|fix|swap|replace|shorter|longer|warmer|funnier|softer|punchier|different|instead|less |more |add |remove|drop the|take out|make it|can you make)\b/i;
const QUESTION_RE =
  /(\?\s*$)|^\s*(what|when|where|why|how|who|which|can (?:i|you|we)|do (?:i|you|we)|does|did|is|are|will)\b/i;

@Injectable()
export class IntentService {
  private readonly log = new Logger(IntentService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Classify a steady-state message. Haiku when a key is set (it catches the
   * polite, rambly approvals real people send — "oh that's lovely, yeah go
   * for it"); deterministic patterns offline so the loop works for free.
   */
  async classify(body: string, hasPendingPost: boolean): Promise<IntentResult> {
    const text = body.trim();
    if (!text) return { intent: 'other' };

    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (llmOn) {
      try {
        return await this.classifyWithLlm(text, hasPendingPost);
      } catch (err) {
        this.log.warn(`LLM intent failed, using patterns: ${String(err)}`);
      }
    }
    return this.classifyOffline(text);
  }

  private async classifyWithLlm(
    text: string,
    hasPendingPost: boolean,
  ): Promise<IntentResult> {
    return this.llm.completeJson(
      {
        tier: 'bulk',
        cachedContext:
          'You classify a small-business owner\'s SMS reply to their social ' +
          'media assistant. Return ONLY JSON: {"intent": one of ' +
          '"approve"|"revise"|"cancel"|"question"|"other", "feedback": string}. ' +
          'approve = they are happy for the draft to go out. ' +
          'revise = they want the post changed (put what they want changed in ' +
          '"feedback", in their own words). cancel = they do not want this post ' +
          'published at all. question = they are asking something. ' +
          'other = anything else. Be decisive; casual agreement ("yeah go for ' +
          'it", "love it send it") is approve.',
        prompt:
          `There ${hasPendingPost ? 'IS' : 'is NO'} draft currently awaiting ` +
          `their approval.\nOwner's message: """${text}"""`,
        maxTokens: 300,
      },
      LlmIntent,
    );
  }

  /**
   * Order is the whole design here. A revise request often opens with
   * agreement ("yeah, but make it shorter") and a cancel often contains
   * edit-ish words ("don't make it longer"), so we test most-specific first:
   * cancel → revise → approve → question.
   */
  private classifyOffline(text: string): IntentResult {
    if (CANCEL_RE.test(text)) return { intent: 'cancel' };
    if (REVISE_RE.test(text)) return { intent: 'revise', feedback: text };
    if (APPROVE_RE.test(text)) return { intent: 'approve' };
    if (QUESTION_RE.test(text)) return { intent: 'question' };
    return { intent: 'other' };
  }
}
