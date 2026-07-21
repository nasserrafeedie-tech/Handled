import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../operator/llm/llm.service';

/**
 * What the owner meant (§6).
 *
 * Handled deliberately has almost no keywords. An owner shouldn't have to
 * remember that "AUTOPILOT" is a magic word — they should be able to say
 * "just post it, stop asking me" and be understood. So everything except the
 * two legally-mandated keywords (STOP, HELP, handled deterministically before
 * this ever runs) is interpreted here.
 *
 * Post-related, when a draft is waiting:
 *   approve  "yes" / "looks good" / "send it" / 👍
 *   revise   "make it warmer" / "swap the photo" / "shorter please"
 *   cancel   "skip this one" / "don't post that"
 *
 * Account-level, any time:
 *   see_plan       "what are you actually doing for me?" / "show me the plan"
 *   autopilot_on   "stop asking me every time, just post"
 *   autopilot_off  "check with me before posting from now on"
 *   upgrade        "how do I get reels?" / "what's the next tier"
 *   refer          "my friend wants this" / "do you have a referral thing"
 *   start_over     "everything you know about us is wrong, start again"
 *
 *   question / other — answered, not acted on.
 */
export type OwnerIntent =
  | 'approve'
  | 'revise'
  | 'cancel'
  | 'see_plan'
  | 'autopilot_on'
  | 'autopilot_off'
  | 'upgrade'
  | 'refer'
  | 'ai_images_on'
  | 'ai_images_off'
  | 'start_over'
  | 'question'
  | 'other';

export interface IntentResult {
  intent: OwnerIntent;
  /** 0-1. Below CONFIRM_BELOW we ask rather than assume. */
  confidence: number;
  /** For `revise`: what the owner wants changed, in their own words. */
  feedback?: string;
}

/**
 * Interpreting free text is less certain than matching a keyword, so an
 * unclear reading gets confirmed instead of acted on. Applies to every
 * intent, not just the dangerous ones.
 */
export const CONFIRM_BELOW = 0.7;

/**
 * Actions that change what the world sees, or throw away work. These confirm
 * even at high confidence — being sure you were asked isn't the same as the
 * owner being sure they want it.
 */
export const CONSEQUENTIAL: ReadonlySet<OwnerIntent> = new Set([
  'start_over', // wipes the brand profile
  'autopilot_on', // posts start publishing without their eyes on them
  'ai_images_on', // model-made photos start representing their business
]);

const LlmIntent = z
  .object({
    intent: z.enum([
      'approve',
      'revise',
      'cancel',
      'see_plan',
      'autopilot_on',
      'autopilot_off',
      'upgrade',
      'refer',
      'ai_images_on',
      'ai_images_off',
      'start_over',
      'question',
      'other',
    ]),
    confidence: z.number().min(0).max(1).default(0.8),
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

/* Account-level patterns for the offline path. The old keywords survive here
   as one alternative among many — someone who read "reply AUTOPILOT" in an
   older text still works, without anyone being required to remember it. */
const SEE_PLAN_RE =
  /^\s*(plan|strategy)\s*$|\b(what(?:'s| is| are you)?\s+(?:my|the|our)\s+(?:plan|strategy)|show me (?:my|the) (?:plan|strategy)|what are you (?:doing|posting)|what'?s coming up|what'?s scheduled)\b/i;
const AUTOPILOT_ON_RE =
  /^\s*autopilot\s*$|\b(stop asking me|don'?t ask me|quit asking|just post|post (?:them|it|stuff) without|no need to (?:ask|check)|you don'?t have to (?:ask|check)|turn on autopilot|go on autopilot|full ?auto)\b/i;
const AUTOPILOT_OFF_RE =
  /^\s*manual\s*$|\b(ask me (?:first|before)|check with me|run (?:them|it) by me|i want to approve|let me approve|back to approving|turn off autopilot)\b/i;
const UPGRADE_RE =
  /^\s*upgrade\s*$|\b(upgrade|next tier|higher plan|bigger plan|more posts per week|get reels|add reels|growth plan|pro plan)\b/i;
const REFER_RE =
  /^\s*refer(?:ral)?\s*$|\b(refer|referral|friend of mine|another owner|share (?:this|handled) with|recommend (?:you|handled))\b/i;
const START_OVER_RE =
  /^\s*reset\s*$|\b(start over|start again|from scratch|redo (?:my |the )?(?:profile|setup|onboarding)|wipe (?:my|the) profile|everything you (?:know|have) (?:about us )?is wrong)\b/i;

@Injectable()
export class IntentService {
  private readonly log = new Logger(IntentService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Classify any steady-state message. Haiku when a key is set (it catches
   * the polite, rambly things real people send — "oh that's lovely, yeah go
   * for it"); deterministic patterns offline so the loop works for free.
   */
  async classify(body: string, hasPendingPost: boolean): Promise<IntentResult> {
    const text = body.trim();
    if (!text) return { intent: 'other', confidence: 1 };

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
        cachedContext: [
          "You classify a small-business owner's text to Handled, the service",
          'that runs their social media. Return ONLY JSON:',
          '{"intent": string, "confidence": number 0-1, "feedback": string}.',
          '',
          'Intents about a draft they were shown:',
          '- approve: happy for it to go out ("yes", "love it", "send it")',
          '- revise: wants it changed — put what they want in "feedback"',
          '- cancel: does not want this particular post published',
          '',
          'Intents about their account:',
          '- see_plan: wants to know their strategy, what we do for them, or',
          '  what is coming up',
          '- autopilot_on: wants us to stop asking before each post',
          '- autopilot_off: wants to approve posts again before they go out',
          '- upgrade: asking about more posts, reels, or a bigger plan',
          '- refer: wants to refer someone, or asking about a referral',
          '- ai_images_on: has no time to take photos and wants us to make',
          '  them ("can you make the pictures", "I never get round to photos")',
          '- ai_images_off: wants us to stop making photos for them',
          '- start_over: wants their whole profile rebuilt from scratch',
          '',
          '- question: asking something we should answer',
          '- other: anything else',
          '',
          'confidence is how sure you are, and it matters: a low score makes',
          'us ask before acting, which is the right outcome for an ambiguous',
          'message. Be honest rather than agreeable — score low when a text',
          'could plausibly be two different intents.',
          'Complaints are NOT start_over unless they actually ask to rebuild:',
          '"this caption is wrong" is revise; "everything about us is wrong,',
          'start again" is start_over.',
        ].join('\n'),
        prompt:
          `There ${hasPendingPost ? 'IS' : 'is NO'} draft currently awaiting ` +
          `their approval.\nOwner's message: """${text}"""`,
        maxTokens: 300,
      },
      LlmIntent,
    );
  }

  /**
   * Order is the whole design here. Account-level intents are checked before
   * post-level ones, because "redo my profile" would otherwise trip the
   * revise pattern on "redo".
   */
  private classifyOffline(text: string): IntentResult {
    // Literal patterns, so a hit is a confident hit — the ambiguity this
    // system worries about is the model's, not the regex's.
    if (START_OVER_RE.test(text)) return { intent: 'start_over', confidence: 0.9 };
    if (AUTOPILOT_OFF_RE.test(text)) return { intent: 'autopilot_off', confidence: 0.9 };
    if (AUTOPILOT_ON_RE.test(text)) return { intent: 'autopilot_on', confidence: 0.9 };
    if (SEE_PLAN_RE.test(text)) return { intent: 'see_plan', confidence: 0.9 };
    if (UPGRADE_RE.test(text)) return { intent: 'upgrade', confidence: 0.9 };
    if (REFER_RE.test(text)) return { intent: 'refer', confidence: 0.9 };

    if (CANCEL_RE.test(text)) return { intent: 'cancel', confidence: 0.85 };
    if (REVISE_RE.test(text)) return { intent: 'revise', confidence: 0.85, feedback: text };
    if (APPROVE_RE.test(text)) return { intent: 'approve', confidence: 0.85 };
    if (QUESTION_RE.test(text)) return { intent: 'question', confidence: 0.8 };
    return { intent: 'other', confidence: 1 };
  }
}
