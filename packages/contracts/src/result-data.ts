import { z } from 'zod';
import { Platform, PostArchetype } from './enums';

/**
 * Structured `data` payloads returned inside a Result for specific Task types.
 * The Operator validates these before returning so the Concierge can rely on
 * shape instead of re-parsing prose (§4: "structured: the draft, metrics, ...").
 */

const iso8601 = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** One slot in a planned week (PLAN_WEEK result + the LLM planning output). */
export const CalendarSlot = z
  .object({
    date: isoDate,
    archetype: PostArchetype,
    platform: Platform,
    best_time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
    needs_asset: z.boolean(),
    shot_list: z.string().max(500).optional(),
  })
  .strict();
export type CalendarSlot = z.infer<typeof CalendarSlot>;

/** PLAN_WEEK → data */
export const PlanWeekResult = z
  .object({
    week_start: isoDate,
    slots: z.array(CalendarSlot),
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
  .object({ slots: z.array(CalendarSlot) })
  .strict();
export type PlanWeekLlmOutput = z.infer<typeof PlanWeekLlmOutput>;

/** The bare shape the caption LLM must return for one post (JSON only, §12). */
export const CaptionLlmOutput = z
  .object({
    caption: z.string().min(1),
    hashtags: z.array(z.string()),
  })
  .strict();
export type CaptionLlmOutput = z.infer<typeof CaptionLlmOutput>;
