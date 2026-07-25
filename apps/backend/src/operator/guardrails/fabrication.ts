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

/**
 * Someone reporting speech to us: "…told us", "…said".
 *
 * The quote characters deliberately exclude apostrophes. An earlier version
 * accepted them as delimiters, so "doesn't … don't" read as a quoted span and
 * the check fired on four captions out of five — none of which had invented
 * anything. A guard that cries wolf on ordinary contractions is worse than no
 * guard: it burns a rewrite on every post and pins clean work to manual
 * approval. Attribution is the signal, not punctuation.
 */
const ATTRIBUTION = /\b(?:told|said|says|wrote|shared|texted|messaged)\s+(?:us|me)\b/i;

/** A span inside real double quotes — never apostrophes. */
const QUOTED_SPAN = /["“][^"”\n]{12,}["”]/;

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

/**
 * A specific recent event the owner never told us happened.
 *
 * The invented customer is not the only lie the drafter writes. Given only
 * "banana bread" in the offers, it produced "we taste-tested 3 batches this
 * afternoon to get the crumb right — which one won?" — a specific event, on a
 * specific day, that as far as we know never took place. It reads charming and
 * it is fiction, published under the owner's name. The owner caught it here;
 * on autopilot nobody would.
 *
 * The tell is a first-person ACTION ("we're testing", "we baked", "I roasted")
 * pinned to a RECENT moment ("this afternoon", "today", "this week"). That pair
 * is a claim that a particular thing happened — which the drafter has no way to
 * know. Evergreen habit ("we bake fresh every morning") and plain state ("we're
 * open today") are deliberately NOT this: no recent one-off action is asserted,
 * so they stay clean. Numbers alone are fine too ("3 new flavors") — it is the
 * dated action, not the digit, that fabricates.
 */
const RECENCY =
  /\b(?:this (?:morning|afternoon|evening|week|weekend|month)|today|yesterday|last (?:week|night|month)|earlier (?:today|this week)|just now)\b/i;
// Actor + a doing-verb in -ed/-ing. Excludes "we'll …" (future, not an event)
// and "we're open" (state, not a -ed/-ing action), which is why the "allows"
// cases below stay clean.
// The action word may be hyphenated ("taste-tested"), so an internal hyphen
// segment is allowed before the -ed/-ing ending.
const FIRST_PERSON_ACTION =
  /\b(?:we|i|our team|the team|our (?:crew|staff|bakers?|baristas?))(?:'re|'ve| are| have| just)?\s+(?:just\s+)?[a-z]{3,}(?:-[a-z]+)*(?:ed|ing)\b/i;

export interface FabricationFinding {
  name: 'attributed_quote' | 'invented_person' | 'claimed_result' | 'invented_event';
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
  if (hasRealQuote) return out;

  const attributed = ATTRIBUTION.test(caption);
  const person = INVENTED_PERSON.test(caption) || SITUATED_PERSON.test(caption);
  const quoted = QUOTED_SPAN.test(caption);

  // Reporting what a specific person said is the shape that matters. Either
  // half alone is ordinary copy — plural sentiment ("owners tell us…") has no
  // one person in it, and a quoted phrase with nobody behind it is just a
  // turn of phrase.
  if (attributed && (person || quoted)) {
    out.push({
      name: 'attributed_quote',
      detail: 'reports what a specific customer said, and we have no such quote',
    });
  } else if (person && quoted) {
    out.push({
      name: 'attributed_quote',
      detail: 'puts words in the mouth of one invented customer',
    });
  } else if (person) {
    out.push({ name: 'invented_person', detail: 'describes one specific customer' });
  }

  if (person && CLAIMED_RESULT.test(caption)) {
    out.push({
      name: 'claimed_result',
      detail: 'claims a result for a customer we invented',
    });
  }

  // A dated one-off action the owner never reported. Both halves are required:
  // the action makes it a claim, the recency makes it a specific event rather
  // than an evergreen habit.
  if (RECENCY.test(caption) && FIRST_PERSON_ACTION.test(caption)) {
    out.push({
      name: 'invented_event',
      detail: 'states a specific recent event the owner never told us happened',
    });
  }
  return out;
}

/** Feedback for the one retry, naming what to do instead. */
export function fabricationFeedback(findings: FabricationFinding[]): string {
  const hasEvent = findings.some((f) => f.name === 'invented_event');
  const hasPerson = findings.some((f) => f.name !== 'invented_event');
  const lines = [
    'That draft states something we cannot know is true: ' +
      findings.map((f) => f.detail).join('; ') + '.',
  ];
  if (hasPerson) {
    lines.push(
      'Rewrite it with NO specific customer and NO quotation marks. Say what the',
      'business does and who it is for, or use plural sentiment that claims',
      'nothing about one person ("owners tell us…", "the people we work with…").',
      'Do not describe results any individual got.',
    );
  }
  if (hasEvent) {
    lines.push(
      'Do NOT invent a specific event or say a particular thing happened on a',
      'given day ("we tested 3 batches this afternoon"): we only know what the',
      'owner told us. Write about what the business offers as an evergreen truth',
      '("our banana bread is baked fresh") or an invitation ("come try it"),',
      'never as dated news we made up.',
    );
  }
  return lines.join(' ');
}
