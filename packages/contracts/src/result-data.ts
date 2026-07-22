import { z } from 'zod';
import { Platform, PostArchetype } from './enums';

/**
 * Structured `data` payloads returned inside a Result for specific Task types.
 * The Operator validates these before returning so the Concierge can rely on
 * shape instead of re-parsing prose (§4: "structured: the draft, metrics, ...").
 */

const iso8601 = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/**
 * Models write enums the way a person would — "Instagram", "Behind The
 * Scenes" — and a strict enum rejects the whole week's plan over the capital
 * letter. Normalize to the canonical form before validating; what we STORE
 * stays exactly the enum, so nothing downstream has to be case-aware.
 */
// The constraint has to be the mutable tuple, not a readonly one: that is what
// z.ZodEnum itself is declared with, and `readonly` here does not widen to it.
// Getting this wrong broke `tsc -p packages/contracts` while leaving the
// backend compiling against an already-built dist/, so local builds looked fine
// and only the deploy failed.
const lenientEnum = <T extends [string, ...string[]]>(e: z.ZodEnum<T>) =>
  z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v.trim().toLowerCase().replace(/[\s-]+/g, '_')
        : v,
    e,
  );

/**
 * Planner models keep confusing a platform with a format. "Reels" and "Stories"
 * are Instagram surfaces, not separate platforms, and a model following a
 * playbook writes them as if they were — which used to fail the whole week's
 * plan on a strict enum. These map to their real platform. Aliases for
 * platforms we do not support (Google Business Profile) are deliberately absent
 * so those slots drop out rather than being mis-posted somewhere else.
 */
const PLATFORM_ALIAS: Record<string, string> = {
  instagram_reels: 'instagram',
  instagram_reel: 'instagram',
  reels: 'instagram',
  reel: 'instagram',
  instagram_stories: 'instagram',
  instagram_story: 'instagram',
  stories: 'instagram',
  story: 'instagram',
  ig: 'instagram',
  insta: 'instagram',
  fb: 'facebook',
  twitter: 'x',
};

const platformField = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const norm = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PLATFORM_ALIAS[norm] ?? norm;
}, Platform);

/**
 * An array that drops elements it cannot parse instead of failing whole.
 *
 * One slot the planner scheduled to an unsupported platform (Google Business
 * Profile, which dentists' playbooks all push) used to reject the entire week —
 * the owner got zero posts. Better to keep the four good slots and quietly lose
 * the one we cannot serve than to lose the week over it.
 */
const droppingArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((el) => schema.safeParse(el).success) : v),
    z.array(schema),
  );

/** One slot in a planned week (PLAN_WEEK result + the LLM planning output). */
export const CalendarSlot = z
  .object({
    date: isoDate,
    archetype: lenientEnum(PostArchetype),
    platform: platformField,
    best_time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
    needs_asset: z.boolean(),
    // Models often return a shot LIST as an actual list — accept both shapes
    // and store one string.
    shot_list: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) =>
        v === undefined
          ? undefined
          : (Array.isArray(v) ? v.join('; ') : v).slice(0, 500),
      ),
  })
  .strict();
export type CalendarSlot = z.infer<typeof CalendarSlot>;

/** PLAN_WEEK → data */
export const PlanWeekResult = z
  .object({
    week_start: isoDate,
    slots: droppingArray(CalendarSlot),
    shot_list_request_ids: z.array(z.string().uuid()).default([]),
  })
  .strict();
export type PlanWeekResult = z.infer<typeof PlanWeekResult>;

/** DRAFT_POST / REGENERATE_POST → data */
export const DraftPostResult = z
  .object({
    post_id: z.string().uuid(),
    platform: Platform,
    archetype: PostArchetype,
    caption: z.string(),
    hashtags: z.array(z.string()),
    media_refs: z.array(z.string()),
    scheduled_time: iso8601.nullable(),
    risk_level: z.enum(['low', 'high']),
    // The owner has no photo banked for this one and has asked us to make
    // pictures. The caller starts GENERATE_IMAGE — the handler cannot, because
    // dispatching through the TaskBus from inside a handler is circular.
    needs_image: z.boolean().default(false),
    // This is an informational post (a tip, a product explainer) with no owner
    // photo — better as a swipeable carousel than a single image. The caller
    // starts GENERATE_CAROUSEL, for the same circular-dispatch reason as above.
    needs_carousel: z.boolean().default(false),
  })
  .strict();
export type DraftPostResult = z.infer<typeof DraftPostResult>;

/** Per-post performance (FETCH_METRICS → data). */
export const PostMetrics = z
  .object({
    post_id: z.string().uuid(),
    external_post_id: z.string().nullable(),
    impressions: z.number().int().nonnegative(),
    likes: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    shares: z.number().int().nonnegative(),
    saves: z.number().int().nonnegative(),
    fetched_at: iso8601,
  })
  .strict();
export type PostMetrics = z.infer<typeof PostMetrics>;

export const FetchMetricsResult = z
  .object({ metrics: z.array(PostMetrics) })
  .strict();
export type FetchMetricsResult = z.infer<typeof FetchMetricsResult>;

/**
 * The bare shape the planning LLM must return (JSON only, §12). Wrapping schema
 * used by `parseLlmJson` so a malformed model response is rejected + retried.
 */
export const PlanWeekLlmOutput = z
  .object({ slots: droppingArray(CalendarSlot) })
  .strict();
export type PlanWeekLlmOutput = z.infer<typeof PlanWeekLlmOutput>;

/** MAKE_GRAPHIC → data. One entry per rendered slide. */
export const MakeGraphicResult = z
  .object({
    slides: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          media_ref: z.string().describe('stored image reference / path'),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          bytes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type MakeGraphicResult = z.infer<typeof MakeGraphicResult>;

/** The bare shape the caption LLM must return for one post (JSON only, §12). */
export const CaptionLlmOutput = z
  .object({
    caption: z.string().min(1),
    // Models sometimes emit "#cosmetic dentistry" — a broken tag on every
    // platform. Normalize at the boundary: strip '#', remove spaces, drop empties.
    hashtags: z
      .array(z.string())
      .transform((tags) =>
        tags
          .map((t) => t.replace(/^#+/, '').replace(/\s+/g, ''))
          .filter((t) => t.length > 0),
      ),
    /**
     * Screen-reader description of the image (<125 chars). Doubles as a real
     * ranking input — the platforms read it to understand what's in the frame —
     * and almost no small business ever writes one. Optional so an older or
     * terser model response still validates.
     */
    alt_text: z.string().max(300).optional(),
  })
  .strict();
export type CaptionLlmOutput = z.infer<typeof CaptionLlmOutput>;
