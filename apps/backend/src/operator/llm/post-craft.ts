import type { Platform, PostArchetype } from '@smm/contracts';

/**
 * What makes a post worth stopping for, and the checks that it got there.
 *
 * Owner feedback (Nov 2026): the posts read as boring — nobody would stop to
 * read them. Looking at real drafts, the slop detector was doing its job (no
 * "elevate", no "nestled") and the posts were still empty: a pleasant hook, a
 * line of mood, "come see us". Clean and forgettable. The fabrication rules
 * are right to forbid invented facts, but with nothing else asked of it the
 * model filled the space with politeness.
 *
 * So every post now has to carry a PAYLOAD — one concrete thing the reader
 * didn't have before (a real item and its detail, a step they can do today, a
 * fact, an honest reason) — and it is told which ANGLE to take, rotated so a
 * week doesn't run the same shape four times. Then the draft is checked: a
 * first line that could open anyone's post, filler phrasing, or no concrete
 * anchor at all gets one rewrite with the problem named, exactly like slop.
 */

export interface PostAngle {
  key: string;
  /** What the post does, said to the writer. */
  brief: string;
  /** Angles that are naturally a short list (steps, checks) get more room. */
  list?: boolean;
}

/**
 * The angles each archetype can take. Every brief says where its specifics
 * may come from, so an angle never becomes a reason to invent one.
 */
export const ANGLES: Record<PostArchetype, PostAngle[]> = {
  educational_tip: [
    {
      key: 'the-mistake',
      brief:
        'THE MISTAKE: name one specific thing people get wrong about this, what it costs them, and the fix. The fix is the payload.',
    },
    {
      key: 'quick-how-to',
      list: true,
      brief:
        'QUICK HOW-TO: 2-3 short numbered steps a reader can do today. Each step is a concrete action, not advice to "take care of" something.',
    },
    {
      key: 'myth',
      brief:
        'THE MYTH: one thing people believe that is wrong, said plainly, then what is actually true and what to do instead.',
    },
    {
      key: 'what-a-pro-checks',
      list: true,
      brief:
        'WHAT A PRO CHECKS: the 2-3 things someone in this trade looks at that a customer never thinks to — the insider view, as a short list.',
    },
  ],
  product_spotlight: [
    {
      key: 'who-its-for',
      brief:
        'WHO IT IS FOR: one real item or service from the profile, and the exact person or moment it is right for ("if you…, get the…"). Name the item.',
    },
    {
      key: 'the-detail',
      brief:
        'THE DETAIL: the one thing about a real item from the profile that most people never notice — how it is made, what goes in it, why it is done that way. Only details the profile or researched material gives; otherwise the general craft truth of how such a thing is done.',
    },
    {
      key: 'how-to-order',
      brief:
        'HOW TO ORDER IT: how to get the most out of a real item or service from the profile — what to pair it with, what to ask for, when it is best. Name the item.',
    },
  ],
  behind_the_scenes: [
    {
      key: 'the-part-nobody-sees',
      brief:
        'THE PART NOBODY SEES: one real step of the work a customer never sees, and why it matters to them. No invented times, counts or events — describe the step as how the work is always done.',
    },
    {
      key: 'the-rule-we-keep',
      brief:
        'THE RULE WE KEEP: one standard the business holds itself to and the reason, said as the owner. Draw it from the profile or the plain craft of the trade; never a claim about results.',
    },
    {
      key: 'the-tool',
      brief:
        'THE TOOL OR INGREDIENT: one thing the work depends on and what difference it makes to the customer. Only name a brand or product the profile names.',
    },
  ],
  promo: [
    {
      key: 'the-offer-plain',
      brief:
        'THE OFFER, PLAIN: lead with exactly what you get and the terms the profile gives — the item, the price or discount, the window. No hype words around it; the offer is the hook.',
    },
    {
      key: 'who-should-grab-it',
      brief:
        'WHO SHOULD GRAB IT: the offer from the profile, aimed at one specific kind of customer and the moment it saves them. Terms exactly as given.',
    },
  ],
  testimonial: [
    {
      key: 'the-question-we-get',
      brief:
        'THE QUESTION WE GET MOST: one question customers of this trade really ask, answered straight. No named or quoted customer unless the notes give a real quote.',
    },
    {
      key: 'the-worry',
      brief:
        'THE WORRY: the hesitation a first-time customer has (price, time, pain, awkwardness) and the honest answer to it. General sentiment only — never an invented review.',
    },
  ],
  seasonal: [
    {
      key: 'what-changes-now',
      brief:
        'WHAT CHANGES NOW: one specific thing that is different for the reader at this time of year and what to do about it — tied to the trade, not to the weather in general.',
    },
    {
      key: 'the-seasonal-checklist',
      list: true,
      brief:
        'THE SEASONAL CHECKLIST: 2-3 short things to do or know before the season gets going, as a numbered list.',
    },
  ],
  ugc_repost: [
    {
      key: 'credit-and-why',
      brief:
        'CREDIT AND WHY: thank whoever made it, then say the one specific thing in it worth noticing. Only describe what the notes say is in it.',
    },
  ],
  were_open: [
    {
      key: 'one-reason-today',
      brief:
        'ONE REASON TO COME TODAY: one real item, service or offer from the profile, and why today is a good day for it. Hours only exactly as the profile gives them.',
    },
    {
      key: 'first-visit-guide',
      list: true,
      brief:
        'FIRST VISIT GUIDE: 2-3 short things a first-timer should know — what to order or ask for, how it works. Only facts from the profile; otherwise plain how-it-works for this kind of place.',
    },
  ],
};

/**
 * Rotate through an archetype's angles so the same kind of post doesn't take
 * the same shape every week. Seeded off how many of this archetype are already
 * in the recent window — deterministic, so a retry of the same slot asks for
 * the same angle.
 */
export function pickAngle(archetype: PostArchetype, recentArchetypes: string[]): PostAngle {
  const options = ANGLES[archetype] ?? ANGLES.educational_tip;
  const seen = recentArchetypes.filter((a) => a === archetype).length;
  return options[seen % options.length];
}

/**
 * How long the caption may run. Substance needs room — a three-step how-to
 * doesn't fit in a tweet — but every draft is also read over SMS for approval,
 * so only the list angles on long-form surfaces get it.
 */
export function captionBudget(
  platform: Platform,
  angle: PostAngle,
): { target: number; ceiling: number } {
  const longForm = platform === 'instagram' || platform === 'facebook' || platform === 'google_business';
  return angle.list && longForm ? { target: 450, ceiling: 560 } : { target: 280, ceiling: 380 };
}

/** The writing rules that ask for substance, ready to drop into a prompt. */
export function craftRules(angle: PostAngle, budget: { target: number }): string {
  return [
    `THE ANGLE FOR THIS POST — ${angle.brief}`,
    '',
    'THE PAYLOAD (this is what separates a post someone stops for from wallpaper):',
    'The post must hand the reader ONE concrete thing they did not have',
    'before — a named item and its real detail, a step they can do today, a',
    'fact from the researched material, the honest reason behind something,',
    'an exact offer and its terms. A post that is only mood, welcome or',
    '"come see us" has no payload and fails. Specifics come only from the',
    'brand profile, the notes or the researched material; where those are',
    'thin, use practical know-how any professional in this trade would',
    'confirm, said as general advice — never a number, result or event you',
    'were not given.',
    '',
    'THE HOOK (line 1) — pick the shape that fits the payload:',
    '- The mistake: what people get wrong and what it costs.',
    '- The specific: open on the concrete thing itself — the item, the step, the number.',
    '- The contrarian: "Stop …" or the belief that is wrong.',
    '- The situation: "If you …" naming one reader in one moment.',
    'Never open with "Did you know", "Looking for", "Ever wondered", "Calling',
    'all", "Happy [day]", "It\'s [day]", "[Season] is here", a greeting, or',
    'an exclamation of cheer. Read line 1 alone: if it could open any other',
    "business's post, or if it gives the reader no reason to read line 2,",
    'rewrite it.',
    '',
    'Cut every sentence that a reader would not miss. No "stop by", "come see',
    'us", "made with love", "something for everyone", "treat yourself", "you',
    'deserve", "see you soon" — they fill space and say nothing.',
    angle.list
      ? `Lay the list out as short numbered lines. Keep the whole caption under ${budget.target} characters.`
      : `Keep the caption under ${budget.target} characters. One idea, said tight.`,
  ].join('\n');
}

// ── Checks ──────────────────────────────────────────────────────────────────

export interface CraftFinding {
  name: 'weak-hook' | 'long-hook' | 'name-open' | 'generic-filler' | 'no-payload';
  fix: string;
}

/** Openers that could start any business's post. */
const WEAK_OPENERS: RegExp[] = [
  /^(?:did you know|fun fact|guess what|who else|just a (?:friendly )?reminder|reminder:)/i,
  /^(?:looking for|ever (?:wonder(?:ed)?|thought)|are you (?:looking|ready|tired)|tired of|in need of|need a\b|want a\b)/i,
  /^(?:calling all|attention\b|hey (?:there|friends|everyone|neighbou?rs)|hello\b|hi (?:there|friends|everyone)|good (?:morning|afternoon|evening))/i,
  /^(?:happy|it'?s)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|the weekend|friyay|hump day|holidays?)\b/i,
  /^(?:(?:fall|autumn|winter|spring|summer|the holidays?|holiday season|[a-z]+ season)\s+(?:is|are|has)\s+(?:here|coming|upon us|almost here|officially here|arrived))/i,
  /^(?:it'?s (?:that time|officially)|that time of (?:year|the year))/i,
  /^(?:we(?:'?re| are) (?:open|here|back)\b|come (?:see|visit|check out)|stop by|swing by)/i,
  // The ad-copy openers found in real "boring" drafts: true of every business
  // in the trade, so they tell the reader nothing.
  /^(?:your [a-z]+ deserves?|you deserve|behind every|new to [a-z ]{2,20}\?|[a-z]+ (?:summers?|winters?|mornings?|mondays?|weekends?) (?:are|is|can be) (?:no joke|rough|tough|hard))/i,
  /^(?:we(?:'?re| are) (?:so )?(?:proud|passionate|dedicated)|at [a-z' ]{2,30}, we\b|we believe\b)/i,
];

/** Phrases that fill space without saying anything. */
const FILLER: RegExp[] = [
  /\bcome (?:see|visit|check (?:us )?out)\b/i,
  /\b(?:stop|swing|pop) (?:by|in)\b/i,
  /\bwe can'?t wait to (?:see|welcome|meet)\b/i,
  /\bmade with (?:love|care|passion)\b/i,
  /\bsomething for everyone\b/i,
  /\byou deserve\b/i,
  /\btreat yourself\b/i,
  /\bsee you (?:soon|there)\b/i,
  /\blook(?:ing)? forward to (?:seeing|welcoming)\b/i,
  /\bdon'?t miss (?:out|it)\b/i,
  /\byour new favou?rite\b/i,
  /\bwe'?ve got (?:just )?what you need\b/i,
  /\bthe perfect (?:way|spot|place|gift|treat)\b/i,
  /\b(?:mouth.?watering|tastes? (?:amazing|incredible))\b/i,
  /\bwe take (?:great )?pride\b/i,
  /\bstay a while\b/i,
  /\b(?:a lot of|so much|with) love and care\b/i,
  /\b(?:leave|walk out|feel(?:ing)?) (?:feeling )?(?:your|you're) best\b/i,
  /\bpamper(?:ed|ing)? you\b/i,
  /\bdon'?t let [a-z ]{2,30} ruin\b/i,
  /\b(?:running|run) smoothly\b/i,
  /\bthe perfect place to\b/i,
  /\b(?:book|call|order|come in) (?:your [a-z ]{0,20})?today!/i,
  /\bfor every body\b/i,
  /\bso you can (?:relax|sit back|enjoy|focus)\b/i,
  /\blet us (?:take care|handle|do the)\b/i,
  /\b(?:big|huge|amazing|incredible|great|unbeatable) (?:savings|deals?|sales?|prices)\b/i,
];

const STOP = new Set([
  'about', 'after', 'again', 'also', 'always', 'and', 'any', 'are', 'back', 'been', 'before', 'being',
  'best', 'business', 'call', 'can', 'come', 'customer', 'customers', 'daily', 'each', 'every', 'from',
  'good', 'great', 'have', 'here', 'into', 'just', 'like', 'local', 'made', 'make', 'more', 'most',
  'much', 'only', 'other', 'our', 'over', 'people', 'quality', 'really', 'service', 'services', 'some',
  'than', 'that', 'their', 'them', 'then', 'there', 'they', 'this', 'time', 'today', 'very', 'want',
  'week', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'work', 'would', 'year',
  'your', 'yours', 'fact', 'myth', 'mistake', 'people', 'believe', 'make', 'source', 'researched',
  'material', 'verified', 'claims', 'numbers', 'mechanisms', 'beyond', 'profile', 'brand', 'strongest',
  'never', 'cite', 'names', 'copy', 'itself', 'these', 'those',
]);

/**
 * The concrete words this post could be built on — real items, offers and
 * facts the business gave us or research found. A caption that touches none of
 * them, and has no number either, is describing nothing in particular.
 */
export function concreteAnchors(...sources: Array<string | string[] | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    const text = Array.isArray(s) ? s.join(' ') : s;
    for (const w of text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []) {
      const word = w.replace(/'s$/, '');
      if (!STOP.has(word)) out.add(word);
    }
  }
  return out;
}

/**
 * Practical know-how is a payload too — "Keep it cut-side down", "Stop rinsing
 * with hot water". A sentence that opens on an instruction, other than the
 * closing ask, is the reader being told something to do.
 */
const ASK_VERBS = new Set([
  'send', 'save', 'text', 'call', 'book', 'come', 'tag', 'follow', 'share', 'visit',
  'swing', 'pop', 'grab', 'order', 'shop', 'dm', 'message', 'reply', 'comment', 'like',
  'join', 'head', 'drop', 'tap', 'click', 'check', 'find', 'see', 'try', 'treat', 'stop',
]);
const ADVICE_VERBS = new Set([
  'keep', 'store', 'skip', 'use', 'run', 'clear', 'clean', 'rinse', 'wash', 'let', 'wait',
  'start', 'swap', 'avoid', 'never', 'always', 'ask', 'look', 'leave', 'turn', 'change',
  'replace', 'put', 'set', 'add', 'cut', 'trim', 'brush', 'floss', 'water', 'warm', 'cool',
  'test', 'measure', 'write', 'pick', 'choose', 'bring', 'wear', 'stretch', 'drink', 'eat',
  'don\'t', 'dont', 'stand', 'pull', 'push', 'hold', 'press', 'soak', 'dry',
  'reheat', 'heat', 'cook', 'bake', 'freeze', 'thaw', 'apply', 'wipe', 'scrub', 'fold',
  'tighten', 'loosen', 'unplug', 'open', 'close', 'cover', 'flip', 'shake', 'stir', 'mix',
  'feed', 'walk', 'pump', 'spray', 'sleep', 'unclog', 'reset', 'restart', 'charge',
  'chill', 'refrigerate', 'unwrap', 'wrap', 'moisturize', 'sharpen', 'size', 'tip', 'salt',
]);
function givesAdvice(caption: string): boolean {
  const sentences = caption.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  // "Stop doing X" is the contrarian hook, not the ask — only count it when
  // it is followed by something to stop.
  return sentences.some((x) => {
    const [w, next] = x.toLowerCase().replace(/[^a-z'\s]/g, '').split(/\s+/);
    if (!w) return false;
    if (w === 'stop' && next && !['by', 'in'].includes(next)) return true;
    if (w === 'check' && next && !['out', 'us'].includes(next)) return true;
    if ((w === "don't" || w === 'dont') && next === 'miss') return false;
    if (w === 'let' && (next === 'us' || next === 'me')) return false;
    if (w === 'try' && next && !['our', 'us', 'it', 'the', 'something', 'a', 'one'].includes(next)) return true;
    return ADVICE_VERBS.has(w) && !ASK_VERBS.has(w);
  });
}

function firstLine(caption: string): string {
  const line = caption.trim().split(/\n/)[0] ?? '';
  // A first line can run on into a second sentence; the hook is the first one.
  return line.trim();
}

/** What in this draft would make a reader scroll past. */
export function detectThin(
  caption: string,
  opts: { anchors?: Set<string>; businessName?: string | null } = {},
): CraftFinding[] {
  if (!caption?.trim()) return [];
  const out: CraftFinding[] = [];
  const hook = firstLine(caption);

  if (WEAK_OPENERS.some((r) => r.test(hook))) {
    out.push({
      name: 'weak-hook',
      fix: 'Line 1 is a stock opener that could start any business\'s post. Open on the payload instead: the mistake, the specific thing, the contrarian call, or one reader in one situation.',
    });
  } else if (/^[^.?\n]{0,90}!\s*(?:$|\n)/.test(hook) && !/\d/.test(hook)) {
    // A short exclamation with nothing in it — "Fresh batch, fresh week!"
    out.push({
      name: 'weak-hook',
      fix: 'Line 1 is an exclamation of cheer with nothing in it. Make line 1 say something concrete that makes the reader want line 2.',
    });
  }
  const firstSentence = hook.split(/(?<=[.!?])\s/)[0] ?? hook;
  if (firstSentence.length > 110) {
    out.push({
      name: 'long-hook',
      fix: `The first sentence is ${firstSentence.length} characters; only about 125 show in the feed. Cut line 1 to one sharp sentence under 110 characters.`,
    });
  }
  const name = opts.businessName?.trim();
  if (name && name.length >= 3 && hook.toLowerCase().startsWith(name.toLowerCase())) {
    out.push({
      name: 'name-open',
      fix: 'Do not open with the business name — the profile picture already says who is posting. Open on the payload.',
    });
  }

  const filler = FILLER.filter((r) => r.test(caption)).length;
  if (filler >= 2) {
    out.push({
      name: 'generic-filler',
      fix: 'Cut the filler ("stop by", "come see us", "made with love", "see you soon" and the like). Spend those words on the concrete detail.',
    });
  }

  // With anchors, a post must touch one of them (or carry a number, steps or
  // advice). With none — a bare profile, no research — it can still give
  // advice, and the feedback asks for exactly that rather than for specifics
  // we never gave it, which would only push it to invent.
  const anchors = opts.anchors ?? new Set<string>();
  {
    const words = caption.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? [];
    const touches = words.some((w) => anchors.has(w.replace(/'s$/, '')));
    // A quantity written in words counts as much as one in digits.
    const hasNumber =
      /\d/.test(caption) ||
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|sixty|a few|a couple of)\s+(?:minutes?|hours?|days?|weeks?|months?|years?|times?|inches|degrees|layers?|coats?|cups?|drops?|steps?|sets?|reps?)\b|\b(?:twice|once|three times) (?:a|per) (?:day|week|month|year)\b/i.test(caption);
    const hasSteps = /(?:^|\n)\s*(?:\d[.)]|[-•])\s+\S/.test(caption);
    // The honest reason behind something is a payload too ("…that's how a
    // nail starts peeling") — it tells the reader something they didn't know.
    const explains =
      /\b(?:that'?s (?:how|why|what)|because|which is why|otherwise)\b/i.test(caption) ||
      // A specific choice, "order the espresso, not the drip".
      /\b[a-z]+, not (?:a |an |the )?[a-z]+/i.test(caption) ||
      /\b(?:instead of|rather than)\b/i.test(caption) ||
      // An order to do things in, "walk before breakfast, feed after".
      /\bbefore [a-z' ]{2,30}, [a-z]+ after\b/i.test(caption);
    // Only call it empty when it ALSO leans on a stock opener or filler. Good
    // know-how posts are too varied for a word list to recognise reliably
    // (eight hand-made rounds kept finding new ones it missed), so on its own
    // the absence of a signal is left to the scroll-test judge in the drafter.
    const stock = out.some((f) => f.name === 'weak-hook') || filler >= 1;
    if (stock && !touches && !hasNumber && !hasSteps && !explains && !givesAdvice(caption)) {
      out.push({
        name: 'no-payload',
        fix:
          anchors.size > 0
            ? 'The draft names nothing specific. Build it on one concrete thing from the brand profile, the notes or the researched material — the real item and its detail, the exact offer, the fact — and say it plainly.'
            : 'The draft gives the reader nothing to take away. Build it on one piece of practical know-how a professional in this trade would confirm — a step, a check, the reason something is done a certain way — said as general advice, with no invented numbers or results.',
      });
    }
  }
  return out;
}

/** The correction to hand back, naming only what the draft actually did. */
export function craftFeedback(findings: CraftFinding[]): string[] {
  return findings.map((f) => `- ${f.fix}`);
}
