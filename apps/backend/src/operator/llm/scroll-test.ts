import { z } from 'zod';
import type { LlmService } from './llm.service';

/**
 * The scroll test: would a skeptical local stop for this post?
 *
 * The pattern checks in post-craft.ts catch the stock openers and the filler,
 * and they catch them reliably. What they cannot do is tell a good know-how
 * post from a polite empty one when neither uses a stock phrase — eight
 * hand-made test rounds kept turning up good posts the word lists missed and
 * empty ones they let through. Taste needs a reader, so a cheap model reads
 * the draft the way a scroller would and says whether it lands, and if not,
 * why, in a sentence the writer can act on.
 *
 * Advisory only: any failure (offline, a bad reply, an outage) returns null and
 * the draft carries on as if the judge had passed it.
 */

export const ScrollVerdict = z.object({
  stops: z.boolean(),
  payload: z.string().max(300).nullable().optional(),
  problem: z.string().max(400).nullable().optional(),
});
export type ScrollVerdict = z.infer<typeof ScrollVerdict>;

export function scrollTestPrompt(caption: string, businessType: string): string {
  return [
    `You are a skeptical local scrolling Instagram. This post is from a ${businessType}.`,
    'Decide whether you would stop and read it. You stop only if BOTH hold:',
    '1. Line 1 makes you want line 2 — it names a mistake, a specific thing, a',
    '   contrarian call or your exact situation. A greeting, a slogan, a season',
    '   announcement or a question any business could ask does not.',
    '2. The post hands you ONE concrete thing you did not have: a named item and',
    '   its real detail, a step you can do, a fact, an exact offer with terms, or',
    '   the honest reason something is done a certain way.',
    'Polite posts that would be true of any business in the trade fail, however',
    'well written. Do not judge the facts; judge whether a reader gets anything.',
    '',
    'The post:',
    '"""',
    caption,
    '"""',
    '',
    'Return JSON: {"stops": boolean, "payload": string|null, "problem": string|null}.',
    'payload = the concrete thing the reader gets, in under 15 words, or null.',
    'problem = when it fails, one sentence telling the writer what to fix; else null.',
  ].join('\n');
}

/** Ask the judge. Null when it could not give a usable answer. */
export async function scrollTest(
  llm: Pick<LlmService, 'completeJson'> & { offline?: boolean },
  caption: string,
  businessType: string,
  customerId?: string,
): Promise<ScrollVerdict | null> {
  if (llm.offline) return null;
  try {
    const v = await llm.completeJson(
      { tier: 'bulk', cachedContext: '', prompt: scrollTestPrompt(caption, businessType), maxTokens: 300, customerId },
      ScrollVerdict,
    );
    return typeof v?.stops === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

/** The judge's verdict as a line of rewrite feedback, or null when it passed. */
export function scrollFeedback(v: ScrollVerdict | null): string | null {
  if (!v || v.stops) return null;
  return `- A skeptical reader would scroll past this: ${v.problem?.trim() || 'it gives them nothing concrete to take away.'}`;
}
