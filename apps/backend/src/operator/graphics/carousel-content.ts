/**
 * Turning a post into a swipeable carousel.
 *
 * A carousel is the product's default visual: branded slides that break the
 * caption's real information into a title, a few single-idea points, and an
 * invitation. It out-engages a single photo, it never needs an AI image model,
 * and — because every word is rendered from text we control — it is always
 * spelled correctly. That last part is the whole promise of the product, so the
 * copy the model writes here matters as much as any caption.
 *
 * The honesty rules that govern captions govern slides too, and harder: a slide
 * reads as a confident claim. So no invented statistics, no fabricated reviews,
 * no promises the business hasn't made. The slides restate what the caption
 * already says — they don't add facts the owner never gave us.
 */

import { z } from 'zod';
import type { PostArchetype } from '@smm/contracts';

/**
 * Archetypes that become carousels by default. These are the text-forward,
 * informational posts where breaking the message into slides genuinely helps a
 * reader: a tip, a product explainer, an offer, a piece of sentiment, a
 * seasonal note. The visual-first archetypes (behind_the_scenes, were_open,
 * ugc_repost) are deliberately absent — a wall of text where a photo belongs is
 * worse, not better, so those keep the photo / generated-image path.
 */
const CAROUSEL_ARCHETYPES = new Set<PostArchetype>([
  'educational_tip',
  'product_spotlight',
  'promo',
  'testimonial',
  'seasonal',
]);

/** Is this the kind of post we turn into a carousel rather than a photo? */
export function isCarouselArchetype(archetype: PostArchetype): boolean {
  return CAROUSEL_ARCHETYPES.has(archetype);
}

/**
 * Plans that include carousels. This is a Growth+ headline feature — the single
 * biggest reason to move up from Starter — so Starter gets captions and the
 * owner's own photos, and swipeable branded carousels begin at Growth.
 */
// Only the three tiers billing actually sells. "premium" used to be listed but
// was never a real plan — and because tier-entitlements collapses any unknown
// tier to Starter, keeping a phantom tier here meant the gate said "yes" while
// the concierge told the customer "you have nothing". One list of real tiers.
const CAROUSEL_TIERS = new Set(['growth', 'pro']);

/** Does this plan tier include automatic carousels? */
export function tierHasCarousel(planTier: string): boolean {
  return CAROUSEL_TIERS.has(planTier);
}

/**
 * The slide shape the model may return — a subset of the renderer's SlideSpec,
 * with only the fields the model is allowed to author. `kind` drives the
 * layout; the renderer supplies colour, type, and the brand footer.
 */
export const CarouselSlide = z
  .object({
    kind: z.enum(['title', 'body', 'quote', 'promo', 'cta']),
    headline: z.string().min(1).max(90),
    body: z.string().max(220).optional(),
    /** Button words on the CTA slide — the business's REAL action. */
    cta_label: z.string().min(2).max(24).optional(),
  })
  .strict();
export type CarouselSlide = z.infer<typeof CarouselSlide>;

/** Between a title and a close, a carousel needs enough middle to be worth a swipe. */
export const CarouselLlmOutput = z
  .object({
    slides: z.array(CarouselSlide).min(3).max(6),
  })
  .strict();
export type CarouselLlmOutput = z.infer<typeof CarouselLlmOutput>;

export interface CarouselBrief {
  /** What the business does — "dental practice", "coffee shop". */
  businessType: string;
  /** The post archetype, so the model picks the right shape of story. */
  archetype: PostArchetype;
  /** The caption the carousel accompanies. The slides restate its information. */
  caption: string;
  /** The trading name, for the model to weave a natural closing line — never invented. */
  brandName?: string | null;
}

/**
 * The instruction that asks a model to turn a caption into slides. The caption
 * is the source of truth: the slides carry the same information, sharpened for
 * a swipe, never expanded with facts the caption didn't contain.
 */
export function carouselInstruction(brief: CarouselBrief): string {
  return [
    `Turn this ${brief.archetype.replace(/_/g, ' ')} post for an independent ${brief.businessType} into a short Instagram carousel — the kind a reader swipes through.`,
    '',
    'The post caption (the message the slides deliver):',
    '"""',
    brief.caption,
    '"""',
    '',
    'Return JSON: {"slides": [{"kind": string, "headline": string, "body"?: string, "cta_label"?: string}]}',
    '',
    'A carousel is an ARGUMENT, not a restatement: the hook makes a promise,',
    'each middle slide advances it one concrete step, and the CTA is the',
    'natural conclusion. If a reader shuffled your slides and nothing broke,',
    'the deck has no argument.',
    '',
    'Shape:',
    '- Slide 1 — kind "title": a hook. A short, curiosity-opening headline and a',
    "  one-line subhead in `body`. This is what stops the scroll.",
    '- Middle slides — kind "body": ONE concrete idea per slide, advancing the',
    '  argument. A punchy headline (a few words) and one or two plain sentences.',
    '- Last slide — kind "cta": the ONE real action this business wants, stated',
    '  plainly ("Text us one line about your week", "Book online", "Come in").',
    '  Set `cta_label` to the button words for that SAME action — "Text us",',
    '  "Book now", "Come by" — never a generic "Visit us" that contradicts the',
    '  headline. If the business works over text, the CTA is about texting.',
    brief.brandName ? `  You may name the business ("${brief.brandName}") here; nowhere else needs it.` : '',
    '',
    'Rules:',
    '- 3 or 4 slides unless the caption genuinely carries more. NEVER pad: a',
    '  slide that only says "save this", restates another slide, or exists to',
    '  reach a count is worse than no slide — cut it and ship fewer.',
    '- Facts may come from the caption or the business context above. Do not',
    '  invent statistics, prices, guarantees, timeframes, or claims neither',
    '  contains.',
    '- Never fabricate a customer, a quote, or a review. For a testimonial with no',
    '  real quote, write general sentiment ("what regulars tell us") or an invite.',
    '- Plain, warm, human language. No hype, no buzzwords, no exclamation-mark',
    '  spam, no "elevate", "unlock", "game-changer", "dive in".',
    '- Headlines are display text set very large — keep them SHORT. Aim for under',
    '  45 characters (roughly six words); a title or CTA headline especially.',
    '  "Bleeding gums? Keep going." not "Here is what it means when your gums',
    '  bleed while you are flossing".',
    '- Body text is a sentence or two, not a paragraph. Spelling and grammar must',
    '  be perfect: these are printed on the image exactly as written.',
    '- No hashtags, no emoji inside the slides, no "swipe" instructions.',
  ]
    .filter(Boolean)
    .join('\n');
}
