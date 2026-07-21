/**
 * Catching captions that read like a machine wrote them.
 *
 * A prompt rule is a request, not a guarantee — measured over sampled
 * generations, some of these rules changed the output and some did nothing at
 * all. So the rules live here too, as patterns we can actually check. What we
 * can repair mechanically we repair; what we can't, we regenerate once with the
 * specific problem named; and if it still trips, we log it rather than pretend.
 *
 * The bar for adding a pattern is that a real small-business owner would
 * essentially never write it. "When it comes to" is deliberately absent — it is
 * ordinary speech, and a detector that fires on ordinary speech gets ignored.
 *
 * Severity decides what happens:
 *   • 'tell'    — regenerate. Unmistakably machine-written.
 *   • 'texture' — allowed once; two or more means the voice has gone generic.
 */

export type SlopSeverity = 'tell' | 'texture';

export interface SlopPattern {
  name: string;
  severity: SlopSeverity;
  /** A regex, or a predicate where the judgement needs more than a pattern. */
  test: RegExp | ((caption: string) => boolean);
  /** How to say it back to the model when asking for another attempt. */
  fix: string;
}

/**
 * The adjectives that generated marketing copy reaches for. Needed because
 * "fresh, local, and honest" and "eggs, flour, and butter" are the same shape —
 * only the vocabulary tells them apart, and a regex that matches the shape
 * flags a real ingredient list as slop.
 */
const MARKETING_ADJECTIVES = new Set([
  'artisanal', 'authentic', 'beautiful', 'bespoke', 'bold', 'bright',
  'carefully', 'cozy', 'crafted', 'creative', 'curated', 'delicious',
  'delightful', 'dedicated', 'elegant', 'elevated', 'exceptional', 'exclusive',
  'exquisite', 'flavorful', 'fresh', 'friendly', 'genuine', 'gorgeous',
  'handcrafted', 'handmade', 'hearty', 'honest', 'inviting', 'local',
  'lovely', 'luxurious', 'modern', 'natural', 'passionate', 'perfect',
  'premium', 'quality', 'refreshing', 'rich', 'rustic', 'seamless',
  'simple', 'smooth', 'stunning', 'sustainable', 'thoughtful', 'timeless',
  'unforgettable', 'unique', 'vibrant', 'warm', 'welcoming', 'wholesome',
]);

/**
 * Three marketing adjectives in a row — the signature rhythm of generated copy.
 * Counts a triple only when at least two of the three come from the vocabulary
 * above, so a real list of things passes and "fresh, local, and honest" does
 * not. The trailing word is included: "fresh, local, and honest coffee" is the
 * same tell as "fresh, local, and honest."
 */
function hasAdjectiveTriple(caption: string): boolean {
  const triple = /\b([a-z]{3,14}), ([a-z]{3,14}), and ([a-z]{3,14})\b/gi;
  for (const m of caption.matchAll(triple)) {
    const hits = [m[1], m[2], m[3]].filter((w) =>
      MARKETING_ADJECTIVES.has(w.toLowerCase()),
    ).length;
    if (hits >= 2) return true;
  }
  return false;
}

export const SLOP_PATTERNS: SlopPattern[] = [
  // ── Unmistakable: the stock phrases of AI marketing copy ────────────────
  {
    name: 'not-just',
    severity: 'tell',
    test: /\b(?:it'?s |we'?re |this is )?(?:not just|more than just)\b/i,
    fix: 'Do not use "not just X" or "more than just X".',
  },
  {
    name: 'without-the',
    severity: 'tell',
    test: /\b\w+ (?:—|-) without the \w+/i,
    fix: 'Do not use the "X — without the Y" construction.',
  },
  {
    name: 'whether-youre',
    severity: 'tell',
    test: /\bwhether you'?re\b[^.!?]*\bor\b/i,
    fix: 'Do not open a clause with "whether you\'re… or…". Name one person, not every possible customer.',
  },
  {
    name: 'discovery-verbs',
    severity: 'tell',
    test: /\b(?:discover|unlock|elevate|delve|dive in(?:to)?|indulge in|embark on)\b/i,
    fix: 'Do not use "discover", "unlock", "elevate", "delve", "dive into", "indulge in", or "embark on".',
  },
  {
    name: 'marketing-cliche',
    severity: 'tell',
    test: /\b(?:game.changer|look no further|we'?ve got you covered|next level|say goodbye to|that'?s where we come in|the perfect blend of|one.stop shop)\b/i,
    fix: 'Do not use "game-changer", "look no further", "we\'ve got you covered", "next level", "say goodbye to", "that\'s where we come in", "the perfect blend of", or "one-stop shop".',
  },
  {
    name: 'nestled',
    severity: 'tell',
    test: /\bnestled\b/i,
    fix: 'Do not use "nestled".',
  },
  {
    name: 'fast-paced-world',
    severity: 'tell',
    test: /\bin today'?s\b[^.!?]*\b(?:world|landscape|market|climate)\b/i,
    fix: 'Do not open with "in today\'s [anything] world".',
  },
  {
    name: 'isnt-about-its-about',
    severity: 'tell',
    test: /\bisn'?t (?:just )?about\b[^.!?]*\.\s*it'?s about\b/i,
    fix: 'Do not use "It isn\'t about X. It\'s about Y."',
  },
  {
    name: 'superlative-open',
    severity: 'tell',
    test: /^(?:the (?:best|most|top|ultimate)\b|introducing\b|we(?:'| a)re (?:thrilled|excited|proud) to\b)/i,
    fix: 'Do not open with "The best/most/top/ultimate", "Introducing", or "We\'re thrilled/excited/proud to".',
  },
  {
    name: 'essay-connector',
    severity: 'tell',
    test: /(?:^|[.!?]\s+)(?:moreover|furthermore|in conclusion|additionally|ultimately,)\b/i,
    fix: 'Do not use essay connectors — "moreover", "furthermore", "additionally", "in conclusion", "ultimately".',
  },

  // ── Texture: fine once, generic in bulk ─────────────────────────────────
  {
    name: 'adjective-triple',
    severity: 'texture',
    test: hasAdjectiveTriple,
    fix: 'Avoid three-item lists of adjectives ("fresh, local, and honest").',
  },
  {
    name: 'here-is-the-thing',
    severity: 'texture',
    test: /\b(?:here'?s the (?:thing|kicker|best part)|but here'?s)\b/i,
    fix: 'Do not use "here\'s the thing" or "here\'s the best part".',
  },
  {
    name: 'rhetorical-question-open',
    severity: 'texture',
    test: /^[^.!?]{0,60}\?/,
    fix: 'Do not open with a rhetorical question.',
  },
  {
    name: 'emoji-bullets',
    severity: 'texture',
    test: /(?:^|\n)\s*(?:✨|🔥|💫|👉|✅|💯)/u,
    fix: 'Do not start lines with decorative emoji.',
  },
];

export interface SlopFinding {
  name: string;
  severity: SlopSeverity;
  fix: string;
}

/** Everything in this caption that reads as machine-written. */
export function detectSlop(caption: string): SlopFinding[] {
  if (!caption) return [];
  return SLOP_PATTERNS.filter((p) =>
    typeof p.test === 'function' ? p.test(caption) : p.test.test(caption),
  ).map(({ name, severity, fix }) => ({ name, severity, fix }));
}

/**
 * Is this bad enough to spend another generation on?
 *
 * Any single unmistakable tell, or two texture hits — one rhetorical question
 * is a style choice, one on top of an adjective triple and emoji bullets is a
 * caption that stopped sounding like the business.
 */
export function shouldRegenerate(findings: SlopFinding[]): boolean {
  const tells = findings.filter((f) => f.severity === 'tell').length;
  const texture = findings.filter((f) => f.severity === 'texture').length;
  return tells >= 1 || texture >= 2;
}

/**
 * The correction to hand back to the model, naming only what it actually did.
 *
 * The draft has to be included. Without it the model is being asked to rewrite
 * something it cannot see, and it says so — an eval run produced the reply
 * "I'd need to see the draft you're referring to in order to rewrite it",
 * which then failed to parse as JSON and silently cost a generation.
 */
export function slopFeedback(findings: SlopFinding[], draft: string): string {
  return [
    'Your previous draft was:',
    '"""',
    draft,
    '"""',
    '',
    'It used phrasing that reads as machine-written. Write it again, keeping the same facts and the same point, but fix these specifically:',
    ...findings.map((f) => `- ${f.fix}`),
    "Keep it in the business owner's own voice. Plain words, varied sentence length, nothing that sounds like an advertisement.",
    'Return the same JSON shape as before.',
  ].join('\n');
}
