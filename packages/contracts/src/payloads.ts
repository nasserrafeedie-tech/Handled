import { z } from 'zod';
import {
  Platform,
  PostArchetype,
  TrustLevel,
} from './enums';

/**
 * §4 rule: "Each Task type has its own strict payload schema."
 * These are the strict, per-type payloads. `.strict()` rejects unknown keys so
 * a malformed emit is caught immediately rather than silently ignored.
 */

const uuid = z.string().uuid();
const iso8601 = z.string().datetime({ offset: true });

// ── PLAN_WEEK ──────────────────────────────────────────────────────────────
// Cron- or Concierge-triggered. Produce a week's calendar for a customer.
export const PlanWeekPayload = z
  .object({
    week_start: iso8601.describe('ISO date the plan week begins'),
    posting_frequency: z
      .number()
      .int()
      .min(1)
      .max(21)
      .optional()
      .describe('override; otherwise read from brand_profile'),
    platforms: z.array(Platform).nonempty().optional(),
  })
  .strict();
export type PlanWeekPayload = z.infer<typeof PlanWeekPayload>;

// ── DRAFT_POST ─────────────────────────────────────────────────────────────
// Turn one calendar slot into a caption + hashtags + media, status=draft.
export const DraftPostPayload = z
  .object({
    calendar_slot_id: uuid.optional(),
    platform: Platform,
    archetype: PostArchetype,
    scheduled_time: iso8601.optional(),
    needs_asset: z.boolean().default(false),
    shot_list_hint: z.string().max(500).optional(),
    prompt_notes: z.string().max(1000).optional(),
  })
  .strict();
export type DraftPostPayload = z.infer<typeof DraftPostPayload>;

// ── REGENERATE_POST ────────────────────────────────────────────────────────
// Owner didn't like it. Regenerate caption and/or media using their feedback.
export const RegeneratePostPayload = z
  .object({
    post_id: uuid,
    owner_feedback: z.string().min(1).max(1000),
    regenerate_caption: z.boolean().default(true),
    regenerate_media: z.boolean().default(false),
  })
  .strict();
export type RegeneratePostPayload = z.infer<typeof RegeneratePostPayload>;

// ── SCHEDULE_POST ──────────────────────────────────────────────────────────
// Validated + approved post → enqueue in BullMQ at scheduled_time.
export const SchedulePostPayload = z
  .object({
    post_id: uuid,
    scheduled_time: iso8601,
    /**
     * The owner just said yes over SMS. Carrying the approval on the Task
     * (rather than letting the Concierge mutate the post directly) keeps the
     * §3 boundary intact and leaves the approval in the §4 audit log.
     */
    owner_approved: z.boolean().default(false),
  })
  .strict();
export type SchedulePostPayload = z.infer<typeof SchedulePostPayload>;

// ── CANCEL_POST ────────────────────────────────────────────────────────────
export const CancelPostPayload = z
  .object({
    post_id: uuid,
    reason: z.string().max(500).optional(),
  })
  .strict();
export type CancelPostPayload = z.infer<typeof CancelPostPayload>;

// ── PUBLISH_DUE ────────────────────────────────────────────────────────────
// Cron. Publish everything due (or a specific post) via Post for Me.
export const PublishDuePayload = z
  .object({
    due_before: iso8601.optional().describe('defaults to now at handler time'),
    post_id: uuid.optional().describe('publish one specific post'),
  })
  .strict();
export type PublishDuePayload = z.infer<typeof PublishDuePayload>;

// ── FETCH_METRICS ──────────────────────────────────────────────────────────
export const FetchMetricsPayload = z
  .object({
    post_ids: z.array(uuid).optional(),
    since: iso8601.optional(),
  })
  .strict();
export type FetchMetricsPayload = z.infer<typeof FetchMetricsPayload>;

// ── INGEST_MEDIA ───────────────────────────────────────────────────────────
// Owner texted a photo/video (Twilio media URL) → store in R2, link, fulfill.
export const IngestMediaPayload = z
  .object({
    source_url: z.string().url().describe('Twilio media URL to fetch'),
    content_type: z.string().min(1),
    shot_list_request_id: uuid.optional(),
    post_id: uuid.optional(),
    inbound_message_id: uuid.optional(),
  })
  .strict();
export type IngestMediaPayload = z.infer<typeof IngestMediaPayload>;

// ── ASSEMBLE_REEL ──────────────────────────────────────────────────────────
// Cut the owner's banked clips into a vertical reel (§7). No AI video — real
// footage, normalized to 9:16, trimmed, hard-cut, branded end card. Growth+.
export const AssembleReelPayload = z
  .object({
    /** Specific clips to use, oldest-first when omitted. */
    media_asset_ids: z.array(uuid).max(6).optional(),
    /** Text overlaid on the opening seconds — the watch-time hook. */
    hook_text: z.string().max(80).optional(),
    platform: Platform.default('instagram'),
    scheduled_time: iso8601.optional(),
  })
  .strict();
export type AssembleReelPayload = z.infer<typeof AssembleReelPayload>;

// ── UPDATE_BRAND_PROFILE ───────────────────────────────────────────────────
// Concierge learned something during onboarding / mid-relationship.
// Partial patch — only the fields that changed. `.strip()`-free strict object.
export const UpdateBrandProfilePayload = z
  .object({
    patch: z
      .object({
        business_name: z.string().max(120).optional(),
        business_type: z.string().max(200).optional(),
        voice_tone: z.string().max(300).optional(),
        target_customer: z.string().max(300).optional(),
        offers: z.array(z.string().max(200)).optional(),
        dos_and_donts: z.array(z.string().max(300)).optional(),
        blackout_topics: z.array(z.string().max(200)).optional(),
        posting_frequency: z.number().int().min(1).max(21).optional(),
        brand_colors: z.array(z.string().max(24)).optional(),
        logo_ref: z.string().max(500).optional(),
        reference_photo_refs: z.array(z.string().max(500)).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, {
        message: 'patch must contain at least one field',
      }),
    synthesize_voice: z
      .boolean()
      .default(false)
      .describe('escalate final voice_tone synthesis to Sonnet 5 (§6)'),
  })
  .strict();
export type UpdateBrandProfilePayload = z.infer<typeof UpdateBrandProfilePayload>;

// ── MAKE_GRAPHIC ───────────────────────────────────────────────────────────
// Owner asked for a text graphic / carousel (quote card, "50% OFF" promo, etc).
// The Operator renders crisp SVG→PNG slides — no AI image model needed.
export const SlideSpecInput = z
  .object({
    kind: z.enum(['title', 'body', 'quote', 'promo', 'cta']),
    headline: z.string().min(1).max(200),
    body: z.string().max(400).optional(),
    footer: z.string().max(80).optional(),
  })
  .strict();
export type SlideSpecInput = z.infer<typeof SlideSpecInput>;

export const MakeGraphicPayload = z
  .object({
    slides: z.array(SlideSpecInput).min(1).max(10),
    post_id: uuid.optional().describe('attach rendered slides to this post'),
  })
  .strict();
export type MakeGraphicPayload = z.infer<typeof MakeGraphicPayload>;

// ── PAUSE_CUSTOMER ─────────────────────────────────────────────────────────
// Kill switch (§8). Halt all scheduled publishing immediately.
export const PauseCustomerPayload = z
  .object({
    reason: z.enum(['owner_stop', 'billing', 'moderation', 'admin']),
    resume: z
      .boolean()
      .default(false)
      .describe('true to un-pause a previously paused customer'),
  })
  .strict();
export type PauseCustomerPayload = z.infer<typeof PauseCustomerPayload>;

// Re-export TrustLevel here so callers building UPDATE_TRUST-style flows have it
// available alongside the payloads (used by the Operator publish gate).
export { TrustLevel };
