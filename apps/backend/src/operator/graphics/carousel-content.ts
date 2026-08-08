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
    /** Button words on the CTA slide — the business's REAL action. Truncation
     *  beats rejection: a 30-char label is a style miss, not a bad deck. */
    cta_label: z
      .string()
      .min(2)
      .max(60)
      .transform((s) => s.slice(0, 28))
      .optional(),
  })
  .strict();
export type CarouselSlide = z.infer<typeof CarouselSlide>;

/** Between a title and a close, a carousel needs enough middle to be worth a swipe. */
export const CarouselLlmOutput = z
  .object({
    // Max matches the prompt's 6-10 target (and Instagram's classic 10-slide
    // deck; MMS approval also attaches at most 10). A cap BELOW the prompt's
    // ask is a silent kill switch: the model obeys the prompt, the schema
    // rejects the result, and every deck "couldn't be laid out as slides".
    slides: z.array(CarouselSlide).min(3).max(10),
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
  /**
   * On a redo: what the owner said about the previous deck ("redo the
   * carousel", "less text on the slides"). The new copy honors it — without
   * this, a redo can only reshuffle the same guesses.
   */
  ownerNote?: string | null;
  /**
   * The web-researched fact block the caption was written from (topic
   * research). The only sanctioned source of claims beyond the caption and
   * brand profile — and the raw material that separates a saved deck from
   * wallpaper.
   */
  research?: string | null;
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
    ...(brief.research ? ['', brief.research] : []),
    ...(brief.ownerNote
      ? [
          '',
          'The owner saw an earlier version of this carousel and asked for a redo:',
          '"""',
          brief.ownerNote,
          '"""',
          'Honor that request. Where it names content ("mention the happy hour"),',
          'work it into the slides; where it is only "redo it", take a genuinely',
          'different angle on the same caption — not a paraphrase of the last deck.',
        ]
      : []),
    '',
    'Return JSON: {"slides": [{"kind": string, "headline": string, "body"?: string, "cta_label"?: string}]}',
    '',
    'The hook makes a promise and every slide pays a piece of it: ONE idea,',
    'complete in itself, that leaves the reader wanting the next. Slides are',
    'cards, not chapters — each one must land on its own for the reader who',
    'stops there.',
    '',
    'This deck is the standard — an educational tip for a dental practice.',
    'Match its VOICE and SHAPE. Its content belongs to that business: take',
    'nothing from it but the way it talks.',
    '  1 title: "Your dentist keeps saying floss daily. Here\'s why." — body: "Spoiler: once a week won\'t cut it."',
    '  2 body: "Gum disease starts silently." — "Infections happen in your gums long before you feel pain. By then, damage is already done."',
    '  3 body: "Your toothbrush has limits." — "Floss reaches the spaces between teeth where a brush simply can\'t go. Even 30 seconds between your back teeth makes a real difference."',
    '  4 body: "Bleeding gums? Keep going." — "Bleeding means inflammation. Consistent flossing reduces it over time — it\'s a sign to stick with it, not stop."',
    '  5 cta: "Ready to start?" — "Save this post or send it to someone whose dentist keeps nagging them. We\'re here to answer questions anytime."',
    'Why it works: every headline speaks TO the reader about their own life —',
    'a question they\'d recognise, a "your…", a push — never ABOUT the topic',
    'in the abstract. Every body earns its slide with something concrete: a',
    'number, a mechanism, a thing to do. The wit is dry and lands once or',
    'twice a deck; it is seasoning, not a voice. That deck is five slides;',
    'with richer material the same discipline extends to eight or ten.',
    '',
    'Shape:',
    '- Slide 1 — kind "title": the hook. A PROBLEM-FRAMED promise in 5–8 words',
    '  (the cost, the mistake, the thing they\'re losing — measured to beat',
    '  positive framing), plus a one-line dry subhead in `body`. Readable in',
    '  under one second.',
    '- Slide 2 — kind "body": a SECOND COVER. Instagram re-serves unswiped',
    '  carousels starting at slide 2, so this slide is many readers\' first —',
    '  it restates the hook from a fresh angle and stands completely alone.',
    '- Middle slides — kind "body": ONE concrete idea per slide. Punchy few-word',
    '  headline, body of at most ~20 words. Reference beats rhetoric: signs,',
    '  steps, numbers, what-to-ask, before/after — the stuff a reader SAVES',
    '  because they\'ll need it again.',
    '- Last slide — kind "cta": exactly ONE ask, chosen to fit the deck:',
    '  a save ("Save this for your next …"), a send ("Send this to the friend',
    '  who …"), or the business\'s real action ("Text us one line about your',
    '  week", "Book online", "Come in"). Never stack asks.',
    '  Set `cta_label` to the button words for that SAME action — "Text us",',
    '  "Book now", "Come by" — never a generic "Visit us" that contradicts the',
    '  headline; keep it under 20 characters, it is printed on a small button.',
    '  If the business works over text, the CTA is about texting.',
    brief.brandName ? `  You may name the business ("${brief.brandName}") here; nowhere else needs it.` : '',
    '',
    'Rules:',
    '- THE MATERIAL SETS THE LENGTH. Count the genuinely distinct, concrete',
    '  things you have to say (researched facts, myths, mistakes, real offers)',
    '  and give each ONE slide — that is the deck. Rich material carries 8-10',
    '  slides and engagement rises with count; thin material makes a sharp 5.',
    '  Five slides that each land beat eight that restate each other.',
    '  NEVER pad: a slide that exists to reach a count is the reader\'s cue to leave.',
    '- TAKE A POSITION. Every deck carries at least one opinionated call a',
    '  timid competitor would hesitate to post — a "stop doing X", a myth',
    '  punctured, a number that reframes the habit. If every slide is agreeable,',
    '  the deck is invisible; rewrite until one slide has an edge.',
    '- Every slide body stays under ~20 words. These are cards read at a',
    '  glance, not paragraphs.',
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
    '- Headlines address the reader about THEIR life, never the topic in the',
    '  abstract. "Your toothbrush has limits." not "The limits of brushing";',
    '  if a headline could open a think-piece, rewrite it until it could only',
    '  be said to one person. The title subhead is the wink: one dry line that',
    '  raises the stakes ("Spoiler: once a week won\'t cut it.").',
    '- Body text is a sentence or two, not a paragraph. Spelling and grammar must',
    '  be perfect: these are printed on the image exactly as written.',
    '- No hashtags, no emoji inside the slides, no "swipe" instructions.',
  ]
    .filter(Boolean)
    .join('\n');
}
