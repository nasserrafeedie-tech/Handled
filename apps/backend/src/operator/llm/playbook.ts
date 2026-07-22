import type { Platform } from '@smm/contracts';

/**
 * Distribution playbook — how each platform's ranking system actually behaves,
 * expressed as writing rules the caption model must follow.
 *
 * Researched July 2026. The rules encode a few things that changed recently and
 * that most "social media tips" content still gets wrong:
 *
 *  • Reach is earned by SENDS, not likes. Instagram weights a DM share roughly
 *    3-5x a like, because a send is a person vouching for you to one specific
 *    friend. Every caption should give someone a reason to forward it.
 *  • SAVES are the second currency, and they're what local businesses can
 *    actually win — "hours", "how to keep this alive", "what to order" are all
 *    save-bait in a way that a pretty photo is not.
 *  • Instagram is now a search engine. Plain keywords in the first sentence
 *    ("Pasadena coffee shop") do more for discovery than a wall of hashtags,
 *    and 3-5 specific tags now beat 30 broad ones.
 *  • Only the first ~125 characters show before "... more". If the hook and the
 *    reason to care aren't in there, nothing else in the caption matters.
 *
 * Keeping this in one file means the strategy is reviewable and updatable in
 * one place when the platforms change again — which they will.
 */

/** Shared rules that hold across every surface we publish to. */
const UNIVERSAL: string[] = [
  'Open with a hook in the first 125 characters — that is all anyone sees before the caption truncates. Never open with "We are excited to announce".',
  // Owners can tell when a caption was written by a machine, and so can their
  // customers — it reads like every other AI-written post in the feed and makes
  // the business look like it outsourced its voice.
  //
  // Measured, this rule barely moves the number: across ~70 sampled generations
  // it took the slop rate from 15% to 13%, which is inside the noise. It is kept
  // because it is cheap and may reduce how often the expensive backstop fires.
  // The backstop is what actually works — llm/slop.ts detects these same
  // constructions after generation and regenerates, which takes 15% to 3%. Do
  // not add a rule here and assume it took effect; run slop.eval.ts.
  'Never use these constructions, which read as machine-written: the rhetorical triple ("fast, fresh, and local"); "X — without the Y"; "not just X, it\'s Y"; "more than just a X"; repeated openers like "Sometimes… Sometimes…"; and the phrases "discover", "unlock", "elevate", "dive in", "delve", "game-changer", "look no further", "in today\'s fast-paced world", "nestled in", "whether you\'re… or…", "that\'s where we come in". Do not open with "The best", "The most", or "The top".',
  'Vary sentence length. Machine-written copy runs every sentence to the same medium length; people write a short one, then a longer one that carries the detail, then a fragment.',
  'Write for one specific person, not an audience. Second person ("you"), present tense.',
  'Weave 1-2 plain search keywords naturally into the first two sentences (what the business is, what it sells, the neighbourhood it is in). These platforms are search engines now; keywords in the caption do more for discovery than hashtags.',
  'Earn a SEND or a SAVE, not a like. Close with a reason to forward it to a specific person ("send this to whoever…") or to keep it ("save this for…"). Sends are weighted several times more than likes for reaching new people.',
  'Be concrete. Real prices, real hours, real names, real details from the brand profile. Never invent facts, offers, or claims.',
  'Use the location exactly as the profile gives it — the neighbourhood name is your safest hashtag. Never translate a place name, never use a non-English hashtag, and never expand an abbreviation into a guessed city: "LA" stays the location as written, it does not become "Louisiana" or "New Orleans". A wrong-city hashtag sends the post to the wrong town.',
  'No engagement-bait ("comment YES below", "tag 3 friends"), no hollow hype, no emoji soup. One or two emoji at most, and only where a person would actually use one.',
];

const PER_PLATFORM: Record<Platform, string[]> = {
  instagram: [
    'Caption 80-150 words. Put the hook and the point in the first two lines.',
    'Exactly 3-5 hashtags, all specific and niche (neighbourhood, category, city). Broad tags like #love or #instagood actively waste the slot — Instagram now caps meaningful tags around 5.',
  ],
  facebook: [
    'Shorter than Instagram — 40-80 words. Facebook rewards posts that start conversations between people who already know the business.',
    '0-2 hashtags; they do almost nothing here. Plain language wins.',
  ],
  tiktok: [
    'Very short caption, under 150 characters, written like a person talking.',
    '3-5 hashtags mixing one broad discovery tag with specific niche ones. TikTok search is a real traffic source — write the caption the way someone would type the search.',
  ],
  threads: [
    'Conversational and short, under 300 characters. Written to be replied to.',
    '0-2 hashtags.',
  ],
};

/**
 * Format-level guidance. Which format to reach for is a strategy decision the
 * planner makes; this explains the trade so it chooses deliberately.
 */
export const FORMAT_NOTES = [
  'Reels/video reach 3-5x further than anything else and are how new people find a local business — watch time past the first 3 seconds is the single biggest ranking signal, so the first frame has to earn the second one.',
  'Carousels earn far more saves than single images (roughly 9x) and are the best format for anything a customer might want to come back to: hours, menus, how-to, before/after.',
  'Single photos are for moments that are genuinely good photos. A great real photo with a well-written caption beats a mediocre photo with a graphic slapped on it — do not decorate for the sake of decorating.',
].join('\n');

/** The caption-writing rules for one platform, ready to append to a prompt. */
export function playbookFor(platform: Platform): string {
  return [
    'DISTRIBUTION RULES (follow these exactly — they reflect how this platform ranks content in 2026):',
    ...UNIVERSAL.map((r) => `- ${r}`),
    ...(PER_PLATFORM[platform] ?? []).map((r) => `- ${r}`),
  ].join('\n');
}

/**
 * Alt text is a genuine ranking and accessibility input, and almost nobody
 * writes it. Under ~125 characters, describe what is actually in the frame,
 * with the business's keywords used naturally rather than stuffed.
 */
export const ALT_TEXT_RULE =
  'Also return "alt_text": a literal description of the image under 125 characters for screen readers, including the business type and location naturally. Describe what is visibly in the frame — never repeat the caption.';
