/**
 * The words for an animated reel: written by the model when there is one,
 * worked out from the owner's own words when there isn't.
 *
 * Both paths end in the same checks (spec.ts): the words have to fit the
 * template in the brand's fonts, and no number may appear that the owner
 * didn't give. The model gets one more try with the problems spelled out; if
 * it still misses, the offline copy is used, so a reel is never held up by
 * the copywriter.
 */
import type { z } from 'zod';
import { endCardCopy } from '../end-card';
import type { ReelLook } from './look';
import {
  AnimatedReelSpec,
  inventedNumbers,
  layoutSpec,
  type AnimatedLayout,
  type AnimatedReelKind,
  type BeforeAfterReelSpec,
  type PromoReelSpec,
} from './spec';

export interface SpecContext {
  kind: AnimatedReelKind;
  /** What the reel is about, in the owner's words: an offer, or their ask. */
  source: string;
  businessName?: string | null;
  businessType?: string | null;
  websiteUrl?: string | null;
}

/* ── offline copy ──────────────────────────────────────────────────────── */

const PRICE = /\$\s?\d+(?:\.\d{2})?|\b\d{1,3}\s?%\s?off\b/gi;
const WAS = /\b(?:was|were|usually|normally|regularly|reg\.?)\s+(\$\s?\d+(?:\.\d{2})?)/i;

const WHEN = /\s(?:this (?:week(?:end)?|month)|today|tonight|tomorrow|on (?:weekdays|weekends|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)|every \w+|all (?:week|month|day)|until \w+|through \w+)\b/i;
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(s?)\b/gi;
/** Sentence case, with day names capitalized: "every saturday" → "Every Saturday". */
const cap = (s: string) =>
  s ? (s[0].toUpperCase() + s.slice(1)).replace(DAYS, (_m, d: string, pl: string) => d[0].toUpperCase() + d.slice(1).toLowerCase() + pl) : s;
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.:;!-]+|[\s,.:;!-]+$/g, '').trim();

/** Keep whole words up to `max` characters. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const out: string[] = [];
  for (const w of s.split(' ')) {
    if ([...out, w].join(' ').length > max) break;
    out.push(w);
  }
  return out.join(' ') || s.slice(0, max);
}

function kickerFor(text: string): string {
  if (/\btoday\b/i.test(text)) return 'Today only';
  if (/\bthis week(end)?\b/i.test(text)) return /weekend/i.test(text) ? 'This weekend' : 'This week only';
  if (/\bthis month\b/i.test(text)) return 'This month only';
  if (/\bweekdays?\b|monday|tuesday|wednesday|thursday|friday/i.test(text)) return 'Weekday special';
  if (/\bweekends?\b|saturday|sunday/i.test(text)) return 'Weekend special';
  if (/\bnew (patient|client|customer)s?\b/i.test(text)) return 'For new clients';
  if (/\bholiday|christmas|thanksgiving|black friday\b/i.test(text)) return 'Holiday special';
  return 'Special offer';
}

function endFor(ctx: SpecContext): Pick<PromoReelSpec, 'end_headline' | 'end_body' | 'cta_label'> {
  const card = endCardCopy(ctx);
  const end_headline = /book/i.test(card.ctaLabel) ? 'Book your spot' : 'Come see us';
  // "Book your spot" over "Book your spot today." says it twice: leave the
  // line off when it only repeats the headline.
  const repeats = card.body.toLowerCase().startsWith(end_headline.toLowerCase());
  return {
    end_headline,
    ...(repeats ? {} : { end_body: card.body }),
    cta_label: card.ctaLabel,
  };
}

/**
 * A promo from the owner's own sentence: "kids cuts are $20 on weekdays"
 * becomes "Kids cuts", $20, "On weekdays". Every word on screen is one they
 * used, which is the point of the fallback: plain, but never wrong.
 */
export function offlinePromoSpec(ctx: SpecContext): PromoReelSpec {
  const text = tidy(ctx.source.replace(/^(?:(?:can you|could you|please)\s+)?(?:make|do|post)\s+(?:a|an|me a)?\s*(?:animated\s+|promo\s+)*(?:reel|video)\s+(?:for|about|on)\s+/i, ''));
  const was = WAS.exec(text)?.[1]?.replace(/\s/g, '');
  const withoutWas = was ? text.replace(WAS, '') : text;
  const m = new RegExp(PRICE.source, 'i').exec(withoutWas);
  const price = m?.[0].replace(/\s/g, '').toUpperCase().replace('OFF', ' off');
  let head = m ? withoutWas.slice(0, m.index) : withoutWas;
  let rest = m ? withoutWas.slice(m.index + m[0].length) : '';
  if (!m) {
    // No price: the when ("this weekend", "on weekdays") is a detail, not
    // part of the headline.
    const when = WHEN.exec(head);
    if (when && when.index > 0) {
      rest = head.slice(when.index);
      head = head.slice(0, when.index);
    }
  }
  head = tidy(head).replace(/^(?:our|we have|we've got|get|try|the)\s+/i, '');
  // "kids cuts are only $20": drop the joining words before the price.
  for (let i = 0; i < 3; i++) {
    head = tidy(head.replace(/\s+(?:are|is|for|only|just|now|at|cost|costs|starting at|from)$/i, ''));
  }
  if (!head) {
    // "$20 kids cuts on weekdays": the thing comes after the price.
    const [thing, ...after] = tidy(rest).split(/\s+(?=on|this|every|through|until|all|before|after)\b/i);
    head = tidy(thing ?? '');
    rest = after.join(' ');
  }
  const kicker = kickerFor(text);
  // A detail that only repeats the kicker ("This month" under "This month only") goes.
  const details = [tidy(rest)]
    .filter((d) => d.length >= 2 && !kicker.toLowerCase().startsWith(d.toLowerCase()))
    .map((d) => cap(clip(d, 44)));
  return {
    kind: 'promo',
    kicker,
    headline: cap(clip(head || 'This week at the shop', 36)),
    ...(price ? { price } : {}),
    ...(price && was ? { was_price: was } : {}),
    details,
    ...endFor(ctx),
  };
}

/** Captions for a reveal, in the trade's own terms. */
export function offlineRevealSpec(ctx: SpecContext): BeforeAfterReelSpec {
  const t = ctx.businessType ?? '';
  const [before_caption, after_caption] = /groom|pet|dog|cat/i.test(t)
    ? ['Came in scruffy', 'Left feeling brand new']
    : /barber|hair|salon|stylist/i.test(t)
      ? ['Before the chair', 'After the chair']
      : /nail|lash|brow/i.test(t)
        ? ['Before', 'After the appointment']
        : /clean|detail|wash|pressure/i.test(t)
          ? ['Before we got to work', 'After we got to work']
          : /landscap|lawn|garden|yard/i.test(t)
            ? ['Before', 'After one visit']
            : ['Before', 'After'];
  return { kind: 'before_after', before_caption, after_caption, ...endFor(ctx) };
}

export function offlineSpec(ctx: SpecContext): AnimatedReelSpec {
  return ctx.kind === 'promo' ? offlinePromoSpec(ctx) : offlineRevealSpec(ctx);
}

/* ── checks ────────────────────────────────────────────────────────────── */

export type SpecCheck =
  | { ok: true; spec: AnimatedReelSpec; layout: AnimatedLayout }
  | { ok: false; problems: string[] };

/** Fits the template, and prints no number the owner didn't give. */
export function checkSpec(raw: unknown, ctx: SpecContext, look: ReelLook): SpecCheck {
  const parsed = AnimatedReelSpec.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`) };
  }
  const spec = parsed.data;
  if (spec.kind !== ctx.kind) return { ok: false, problems: [`kind must be ${ctx.kind}`] };
  // The end card's site is the owner's own, so it counts as something they gave.
  const invented = inventedNumbers(spec, `${ctx.source} ${ctx.websiteUrl ?? ''}`);
  const problems = invented.map((n) => `the number ${n} is not in what the owner said`);
  const fit = layoutSpec(spec, look);
  if (!fit.ok) problems.push(...fit.problems);
  return problems.length || !fit.ok ? { ok: false, problems } : { ok: true, spec, layout: fit.layout };
}

/**
 * The offline copy, shortened until it fits. It is built from the owner's
 * words, so it can only fail by being long: each pass drops the last word of
 * the longest line.
 */
export function fittedOfflineSpec(ctx: SpecContext, look: ReelLook): SpecCheck {
  let spec: AnimatedReelSpec = offlineSpec(ctx);
  for (let i = 0; i < 12; i++) {
    const c = checkSpec(spec, ctx, look);
    if (c.ok) return c;
    spec = shorten(spec, c.problems);
  }
  return checkSpec(spec, ctx, look);
}

function dropLastWord(s: string): string {
  const w = s.split(' ');
  return w.length > 1 ? w.slice(0, -1).join(' ') : s;
}

function shorten(spec: AnimatedReelSpec, problems: string[]): AnimatedReelSpec {
  const has = (field: string) => problems.some((p) => p.startsWith(field));
  const s = { ...spec } as AnimatedReelSpec;
  if (s.kind === 'promo') {
    if (has('headline')) s.headline = dropLastWord(s.headline);
    if (has('detail')) s.details = s.details.map((d) => dropLastWord(d));
    if (has('kicker')) s.kicker = 'Special offer';
    if (has('price')) delete s.price;
  } else {
    if (has('before_caption')) s.before_caption = 'Before';
    if (has('after_caption')) s.after_caption = 'After';
  }
  if (has('end_headline')) s.end_headline = 'Come see us';
  if (has('end_body')) delete s.end_body;
  if (has('cta_label')) s.cta_label = 'Visit us';
  return s;
}

/* ── the model's brief ─────────────────────────────────────────────────── */

export function specPrompt(ctx: SpecContext, problems?: string[]): string {
  const fields =
    ctx.kind === 'promo'
      ? [
          '{"kind":"promo",',
          ' "kicker": up to 28 chars, the when or who ("This week only", "New patients"),',
          ' "headline": up to 36 chars, what is on offer in a few plain words ("Fade + beard"),',
          ' "price": the offer price exactly as the owner wrote it ("$35"), or leave it out,',
          ' "was_price": the usual price ONLY if the owner gave one, else leave it out,',
          ' "details": 0 to 2 lines of up to 44 chars: when, and how to get it,',
          ' "end_headline": up to 32 chars, the next step ("Book your chair"),',
          ' "end_body": up to 60 chars, one supporting line or their website,',
          ' "cta_label": up to 18 chars, the button ("Book now", "Come by")}',
        ]
      : [
          '{"kind":"before_after",',
          ' "before_caption": up to 28 chars, over the before photo ("Came in scruffy"),',
          ' "after_caption": up to 28 chars, over the after photo ("Left brand new"),',
          ' "end_headline": up to 32 chars, the next step ("Book their glow-up"),',
          ' "end_body": up to 60 chars, one supporting line or their website,',
          ' "cta_label": up to 18 chars, the button ("Book a groom")}',
        ];
  return [
    `Write the on-screen words for a 12-second animated ${ctx.kind === 'promo' ? 'promo' : 'before-and-after'} reel.`,
    `What it is about, in the owner's words: """${ctx.source}"""`,
    ctx.websiteUrl ? `Their website: ${ctx.websiteUrl}` : 'They have no website.',
    'The animation, colours and fonts are fixed; you only choose the words.',
    'Rules: use only facts the owner gave. Never invent a price, a discount, a date, a',
    'number or a claim. Short, plain words a customer reads in a second. No hashtags,',
    'no emoji, no exclamation marks, sentence case.',
    'Return ONLY JSON in exactly this shape:',
    ...fields,
    ...(problems?.length
      ? ['', 'Your last attempt had these problems; fix every one:', ...problems.map((p) => `- ${p}`)]
      : []),
  ].join('\n');
}

/* ── putting it together ───────────────────────────────────────────────── */

/** The slice of LlmService this needs, so tests can pass a stub. */
export interface SpecWriter {
  completeJson<T>(
    req: { tier: 'bulk' | 'voice' | 'design'; cachedContext: string; prompt: string; maxTokens?: number; customerId?: string },
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T>;
}

export interface BuiltSpec {
  spec: AnimatedReelSpec;
  layout: AnimatedLayout;
  /** Who wrote the words: the model, or the owner's own words (offline). */
  source: 'model' | 'offline';
  problems: string[];
}

/**
 * The model writes the words; anything that doesn't fit or prints a number
 * the owner never gave goes back once with the problems listed, then falls
 * back to the owner's own words. A reel is never held up by the copy.
 */
export async function buildSpec(
  llm: SpecWriter | null,
  ctx: SpecContext,
  look: ReelLook,
  brandContext: string,
  customerId?: string,
): Promise<BuiltSpec> {
  const seen: string[] = [];
  if (llm) {
    let problems: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: unknown;
      try {
        raw = await llm.completeJson(
          { tier: 'voice', cachedContext: brandContext, prompt: specPrompt(ctx, problems), maxTokens: 500, customerId },
          AnimatedReelSpec,
        );
      } catch (err) {
        seen.push(`model: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      const c = checkSpec(raw, ctx, look);
      if (c.ok) return { spec: c.spec, layout: c.layout, source: 'model', problems: seen };
      problems = c.problems;
      seen.push(...c.problems);
    }
  }
  const off = fittedOfflineSpec(ctx, look);
  if (!off.ok) throw new Error(`no copy fits: ${off.problems.join('; ')}`);
  return { spec: off.spec, layout: off.layout, source: 'offline', problems: seen };
}

/**
 * The offer a promo is about: what the owner asked for, else the first offer
 * on their profile with a price in it, else their first offer.
 */
export function pickOffer(asked: string | undefined, offers: string[]): string | null {
  const a = asked?.trim();
  if (a) {
    // "our first groom offer" names a profile offer without its details; use
    // the offer as they wrote it then ("first groom 20% off this month"), so
    // the reel carries the figure they gave rather than none.
    if (!/\d/.test(a)) {
      const words = significant(a);
      const named = offers.find((o) => significant(o).some((w) => words.includes(w)));
      if (named) return named;
    }
    return a;
  }
  return offers.find((o) => /\$\s?\d|\d\s?%/.test(o)) ?? offers[0] ?? null;
}

const FILLER = new Set(['offer', 'offers', 'special', 'specials', 'deal', 'deals', 'promo', 'promotion', 'sale', 'discount', 'this', 'that', 'with', 'from', 'your', 'their', 'week', 'month', 'today', 'every']);
function significant(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !FILLER.has(w));
}
