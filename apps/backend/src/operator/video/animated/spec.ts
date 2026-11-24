/**
 * What an animated reel says, and whether it fits.
 *
 * The model (or the offline fallback) fills in a small spec: the words and,
 * for a reveal, which photo is which. Everything about motion and placement
 * belongs to the template. That split is deliberate. A spec can be checked
 * completely before a single frame is drawn: every line is measured against
 * the real fonts, every number is checked against what the owner actually
 * said, and a spec that fails is refused rather than rendered with words off
 * the edge or a price nobody offered.
 */
import { z } from 'zod';
import { REEL_W, fitSize, lineWidth, wrapTo, type Face } from './kit';
import type { ReelLook } from './look';

const line = (max: number) => z.string().trim().min(2).max(max);

const EndCard = {
  /** The end card's big line: "Book your chair". */
  end_headline: line(32),
  /** One supporting line under it, or the site. */
  end_body: z.string().trim().max(60).optional(),
  /** The real next step, on the button: "Book now", "Come by". */
  cta_label: line(18),
};

export const PromoReelSpec = z
  .object({
    kind: z.literal('promo'),
    /** Small line over the headline: "THIS WEEK ONLY", "WEEKDAYS". */
    kicker: line(28),
    /** What's on offer, a few words: "Kids cuts", "Fade + beard". */
    headline: line(36),
    /** The offer price, exactly as the owner said it: "$20". */
    price: z.string().trim().max(10).optional(),
    /** The usual price, struck through. Only when the owner gave one. */
    was_price: z.string().trim().max(10).optional(),
    /** Up to two short lines: when, and how to get it. */
    details: z.array(line(44)).max(2).default([]),
    ...EndCard,
  })
  .strict();
export type PromoReelSpec = z.infer<typeof PromoReelSpec>;

export const BeforeAfterReelSpec = z
  .object({
    kind: z.literal('before_after'),
    /** Over the before photo: "Came in fluffy". */
    before_caption: line(28),
    /** Over the after photo: "Left brand new". */
    after_caption: line(28),
    ...EndCard,
  })
  .strict();
export type BeforeAfterReelSpec = z.infer<typeof BeforeAfterReelSpec>;

export const AnimatedReelSpec = z.discriminatedUnion('kind', [PromoReelSpec, BeforeAfterReelSpec]);
export type AnimatedReelSpec = z.infer<typeof AnimatedReelSpec>;
export type AnimatedReelKind = AnimatedReelSpec['kind'];

/* ── facts ─────────────────────────────────────────────────────────────── */

/** Every number in a piece of text: "$35", "20%", "2", as bare digits. */
function numbers(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.').replace(/\.0+$/, ''));
}

/**
 * Numbers the spec prints that the owner never gave. A promo is the one post
 * where an invented figure does real harm: a customer walks in expecting a
 * price the shop never offered. So every number on screen must appear in the
 * source text (the owner's offer, their ask), or the spec is refused.
 */
export function inventedNumbers(spec: AnimatedReelSpec, source: string): string[] {
  const known = new Set(numbers(source));
  const printed =
    spec.kind === 'promo'
      ? [spec.kicker, spec.headline, spec.price ?? '', spec.was_price ?? '', ...spec.details]
      : [spec.before_caption, spec.after_caption];
  printed.push(spec.end_headline, spec.end_body ?? '', spec.cta_label);
  return [...new Set(printed.flatMap(numbers))].filter((n) => !known.has(n));
}

/** All the words a viewer will see, for the risk gate and moderation. */
export function onScreenText(spec: AnimatedReelSpec): string {
  const parts =
    spec.kind === 'promo'
      ? [spec.kicker, spec.headline, spec.was_price, spec.price, ...spec.details]
      : [spec.before_caption, spec.after_caption];
  return [...parts, spec.end_headline, spec.end_body, spec.cta_label].filter(Boolean).join(' · ');
}

/* ── layout ────────────────────────────────────────────────────────────── */

export const MARGIN = 96;
const WIDTH = REEL_W - MARGIN * 2;

export interface Block {
  lines: string[];
  size: number;
}

export interface EndLayout {
  headline: Block;
  body?: Block;
  cta: { label: string; size: number; width: number };
  brand?: Block;
}

export interface PromoLayout {
  kind: 'promo';
  kicker: Block;
  headline: Block;
  price?: Block;
  wasPrice?: Block;
  details: Block[];
  end: EndLayout;
}

export interface BeforeAfterLayout {
  kind: 'before_after';
  before: Block;
  after: Block;
  end: EndLayout;
}

export type AnimatedLayout = PromoLayout | BeforeAfterLayout;

export type LayoutResult = { ok: true; layout: AnimatedLayout } | { ok: false; problems: string[] };

const KICKER: Face = { family: 'Poppins', weight: 600, tracking: 5, upper: true };
const TAG: Face = { family: 'Poppins', weight: 600, tracking: 6, upper: true };
const BUTTON: Face = { family: 'Poppins', weight: 700, tracking: 3, upper: true };

/** The largest size in [min, max] at which `text` wraps into `maxLines`. */
function wrapFit(
  text: string,
  face: Face,
  max: number,
  min: number,
  maxLines: number,
  width = WIDTH,
): Block | null {
  for (let size = max; size >= min; size -= 4) {
    const lines = wrapTo(text, face, size, width, maxLines);
    if (lines) return { lines, size };
  }
  return null;
}

function single(text: string, face: Face, max: number, min: number, width = WIDTH): Block | null {
  const size = fitSize([text], face, width, max, min);
  return size === null ? null : { lines: [text], size };
}

function endLayout(
  spec: { end_headline: string; end_body?: string; cta_label: string },
  look: ReelLook,
  problems: string[],
): EndLayout | null {
  const headline = wrapFit(spec.end_headline, look.head, 150, 92, 2);
  if (!headline) problems.push('end_headline does not fit in two lines');
  const body = spec.end_body ? wrapFit(spec.end_body, look.body, 44, 32, 2) : undefined;
  if (spec.end_body && !body) problems.push('end_body does not fit in two lines');
  const cta = single(spec.cta_label, BUTTON, 42, 30, 760);
  if (!cta) problems.push('cta_label is too long for the button');
  const brand = look.brandName ? single(look.brandName, TAG, 34, 22) ?? undefined : undefined;
  if (!headline || (spec.end_body && !body) || !cta) return null;
  return {
    headline,
    body: body ?? undefined,
    cta: {
      label: spec.cta_label,
      size: cta.size,
      width: Math.min(WIDTH, lineWidth(spec.cta_label, BUTTON, cta.size) + 140),
    },
    brand,
  };
}

/**
 * Measure a spec against the brand's fonts. Either every line has a size that
 * fits the frame, or the problems are listed (and the spec goes back, or the
 * fallback copy is used).
 */
export function layoutSpec(spec: AnimatedReelSpec, look: ReelLook): LayoutResult {
  const problems: string[] = [];
  const end = endLayout(spec, look, problems);

  if (spec.kind === 'before_after') {
    const before = wrapFit(spec.before_caption, look.head, 88, 56, 2);
    const after = wrapFit(spec.after_caption, look.head, 88, 56, 2);
    if (!before) problems.push('before_caption does not fit in two lines');
    if (!after) problems.push('after_caption does not fit in two lines');
    if (problems.length || !before || !after || !end) return { ok: false, problems };
    return { ok: true, layout: { kind: 'before_after', before, after, end } };
  }

  const kicker = single(spec.kicker, KICKER, 40, 28);
  if (!kicker) problems.push('kicker is too long');
  // The headline is the star when there is no price, so it may run bigger.
  const headline = wrapFit(spec.headline, look.head, spec.price ? 190 : 220, 104, 3);
  if (!headline) problems.push('headline does not fit in three lines');
  const priceText = spec.price?.trim();
  if (priceText && !/\d/.test(priceText)) problems.push('price has no number in it');
  const price = priceText ? single(priceText, look.head, 260, 140, WIDTH - 220) : undefined;
  if (priceText && !price) problems.push('price is too wide');
  // A "was" price only means something next to a lower price.
  const was = spec.was_price?.trim();
  const wasPrice =
    was && price && /\d/.test(was) && Number(was.replace(/[^\d.]/g, '')) > Number(priceText!.replace(/[^\d.]/g, ''))
      ? single(was, { ...look.body, weight: 500 }, 64, 40, 200) ?? undefined
      : undefined;
  const details: Block[] = [];
  for (const d of spec.details) {
    const b = single(d, look.body, 46, 32);
    if (b) details.push(b);
    else problems.push(`detail "${d}" is too long`);
  }
  if (problems.length || !kicker || !headline || (priceText && !price) || !end) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    layout: { kind: 'promo', kicker, headline, price: price ?? undefined, wasPrice, details, end },
  };
}
