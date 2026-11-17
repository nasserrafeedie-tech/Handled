/**
 * "Make a promo reel for kids cuts, $20 on weekdays" / "can you do a before
 * and after reel". Only an ask that names an animated kind counts: a plain
 * "make a reel" is still a cut of the owner's own clips, and "show me the
 * reel" is a look, not a commission.
 */
export type AnimatedAsk = { kind: 'promo' | 'before_after'; offerText?: string; mediaAssetIds?: string[] };

const LOOK = /\b(see|show|view|send|resend|look at|where('?s| is)|watch)\b[\s\S]{0,30}\b(reel|video)\b/i;
const MAKE = /\b(make|create|design|build|whip up|put together|do|need|want|can (?:you|i get)|could you)\b/i;
const REEL = /\b(reel|video)\b/i;
const REVEAL = /\bbefore\s*(?:and|&|\/|n|-)\s*after\b|\breveal\b|\btransformation\b/i;
const PROMO = /\b(promo|promotion|animated|offer|special|deal|sale|discount)\b|\$\s?\d|\d\s?%\s?off/i;

export function animatedReelAsk(body: string): AnimatedAsk | null {
  if (LOOK.test(body) || !MAKE.test(body) || !REEL.test(body)) return null;
  if (REVEAL.test(body)) return { kind: 'before_after' };
  if (!PROMO.test(body)) return null;
  return { kind: 'promo', offerText: offerFrom(body) };
}

/**
 * The words sent with two photos. The photos themselves are the ask, so
 * "before and after reel" alone counts, with no "make" or "can you".
 */
export function isRevealCaption(body: string): boolean {
  return !LOOK.test(body) && REEL.test(body) && REVEAL.test(body);
}

// "show me the reel", "where's the video", "can I see it again". Narrower than
// LOOK: "send" only counts as "send me", and the owner's own plans ("I'll send
// you the video tomorrow") are not a look.
const SEE = /\b(see|show|view|resend|send me|look at|where('?s| is)|watch|rewatch|link (to|for))\b[\s\S]{0,30}\b(reel|video)\b/i;
const OWN_PLAN = /\b(i'?ll|i will|i'?m (going to|gonna)|gonna|let me)\b/i;

/** The owner wants to see a reel they already have. */
export function isReelLook(body: string): boolean {
  return SEE.test(body) && !OWN_PLAN.test(body);
}

/**
 * "make a reel", "can you do a video for us": a reel with no kind named. A cut
 * of their own clips, so the answer is where to send them (and, when animated
 * reels are on, the two kinds that need no footage).
 */
export function isPlainReelAsk(body: string): boolean {
  return !LOOK.test(body) && MAKE.test(body) && REEL.test(body) && !REVEAL.test(body) && !PROMO.test(body);
}

/**
 * The offer in the ask, with the ask itself taken off: "make a promo reel for
 * kids cuts $20 on weekdays" → "kids cuts $20 on weekdays". Nothing left means
 * they want their usual offer.
 */
export function offerFrom(body: string): string | undefined {
  const rest = body
    .replace(/^[\s\S]*?\b(?:reel|video)\b\s*/i, '')
    .replace(/^(?:for|about|on|of|with|promoting|advertising)\s+/i, '')
    .replace(/^(?:our|my|the)\s+(?:usual\s+)?(?:offer|special|deal|promo)\s*$/i, '')
    .replace(/[\s?.!]+$/, '')
    .trim();
  return /[a-z0-9$]/i.test(rest) && rest.length >= 3 ? rest.slice(0, 400) : undefined;
}
