/**
 * Catching invented customers before they get published.
 *
 * The drafter prompt has forbidden fabricated testimonials since early on, in
 * capitals, calling it a firing offense. It still produced this, unprompted, for
 * a business with no customers at all:
 *
 *   "A salon owner in South Bay told us last week: 'I don't have time to sit
 *    around thinking about Instagram.' … She gets new regulars every month."
 *
 * An invented customer, an invented quote, and an invented result. A prompt is a
 * request; this is the check. It matters more than the usual quality guardrails
 * because the failure is not an awkward sentence — it is a lie published under
 * the owner's name, and the owner is the one who wears it.
 *
 * The test is deliberately narrow: an attributed quote is only a problem when
 * nobody actually said anything. Where the owner has given a real quote, we want
 * it used verbatim, so the caller passes that in and the check stands down.
 */

/** Speech attributed to someone: "…" told us / said / says / wrote. */
const ATTRIBUTED_QUOTE =
  /["“”'‘’][^"“”]{12,}["“”'‘’]\s*[—-]?\s*|(?:told|said|says|wrote|shared|texted|messaged)\s+(?:us|me)\b/i;

/**
 * A specific customer conjured out of nothing — "a salon owner", "one of our
 * regulars", "a client of ours". Plural, generic sentiment ("our regulars tell
 * us") is fine and is what the drafter is asked to fall back on, so the singular
 * article is what this keys on.
 */
const INVENTED_PERSON =
  /\b(?:a|an|one)\s+(?:[a-z]+\s+){0,2}(?:owner|client|customer|patient|regular|guest|member)\b|\bone of (?:our|my)\s+(?:clients|customers|patients|regulars|guests)\b/i;

/**
 * The same invention wearing a trade instead of the word "customer" — "a dentist
 * in Redondo", "a stylist from Hermosa". Placing them somewhere is what makes it
 * a claim about a real person; the trade word alone is ordinary copy ("ask a
 * dentist whether whitening suits you") and must not trip this.
 */
// Deliberately NOT case-insensitive: the trailing [A-Z] has to mean a real
// place name. So the article is spelled out for both cases instead — a caption
// very often opens on one ("A dentist in Redondo…").
const SITUATED_PERSON =
  /\b(?:[Aa]n?|[Oo]ne)\s+(?:[a-z]+\s+){0,2}(?:owner|client|customer|patient|regular|dentist|stylist|barber|baker|florist|chef|trainer|groomer|therapist|mechanic)\s+(?:in|from|over in|down in|at)\s+[A-Z]/;

/** A result claimed on that invented person's behalf. */
const CLAIMED_RESULT =
  /\b(?:she|he|they)\s+(?:now\s+)?(?:gets?|got|sees?|saw|books?|booked|earns?|made|doubled|tripled|grew)\b/i;

export interface FabricationFinding {
  name: 'attributed_quote' | 'invented_person' | 'claimed_result';
  detail: string;
}

/**
 * Does this caption invent a customer?
 *
 * `hasRealQuote` — true when the owner supplied an actual quote for this post.
 * Then an attributed quote is exactly what we asked for, and only the fabricated
 * *result* claim is still worth flagging.
 */
export function detectFabrication(
  caption: string,
  hasRealQuote = false,
): FabricationFinding[] {
  const out: FabricationFinding[] = [];
  const quoted = ATTRIBUTED_QUOTE.test(caption);
  const person = INVENTED_PERSON.test(caption) || SITUATED_PERSON.test(caption);

  if (!hasRealQuote && quoted && person) {
    out.push({
      name: 'attributed_quote',
      detail: 'quotes a specific customer who does not exist',
    });
  } else if (!hasRealQuote && quoted) {
    out.push({
      name: 'attributed_quote',
      detail: 'attributes a quote to someone, with no real quote on file',
    });
  } else if (!hasRealQuote && person) {
    out.push({ name: 'invented_person', detail: 'describes one specific customer' });
  }

  if (!hasRealQuote && CLAIMED_RESULT.test(caption) && person) {
    out.push({
      name: 'claimed_result',
      detail: 'claims a result for a customer we invented',
    });
  }
  return out;
}

/** Feedback for the one retry, naming what to do instead. */
export function fabricationFeedback(findings: FabricationFinding[]): string {
  return [
    'That draft invents a customer, which we never do: ' +
      findings.map((f) => f.detail).join('; ') + '.',
    'Rewrite it with NO specific customer and NO quotation marks. Say what the',
    'business does and who it is for, or use plural sentiment that claims',
    'nothing about one person ("owners tell us…", "the people we work with…").',
    'Do not describe results any individual got.',
  ].join(' ');
}
