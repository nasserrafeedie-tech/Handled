import { z } from 'zod';

/**
 * Shared vocabulary for the whole system. These enums are referenced by the
 * contract (§4), the data model (§5), and both agents. Keep them the single
 * source of truth — do not redefine string literals elsewhere.
 */

/** Social platforms we publish to via Post for Me (§2). */
/**
 * The platforms we publish to.
 *
 * Deliberately short. X, LinkedIn and YouTube were dropped: they are a poor fit
 * for the cafés, salons and barbershops this is built for, and every platform we
 * keep is one more set of limits, failure modes and token refreshes to get right.
 * TikTok stays — its Photo Mode takes 2–35 image carousels, so our flagship
 * format publishes there natively without any video.
 */
export const Platform = z.enum([
  'instagram',
  'facebook',
  'tiktok',
  'threads',
]);
export type Platform = z.infer<typeof Platform>;

/**
 * Post archetypes the planner mixes across a week (§7 PLAN_WEEK). A varied
 * calendar reads as human, not automated.
 */
export const PostArchetype = z.enum([
  'promo',
  'behind_the_scenes',
  'testimonial',
  'educational_tip',
  'product_spotlight',
  'seasonal',
  'ugc_repost',
  'were_open',
]);
export type PostArchetype = z.infer<typeof PostArchetype>;

/** Lifecycle of a post row (§5 posts.status). */
export const PostStatus = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'published',
  'failed',
  'cancelled',
]);
export type PostStatus = z.infer<typeof PostStatus>;

/** Owner-facing approval state, decoupled from lifecycle (§8 approval gates). */
export const ApprovalState = z.enum([
  'not_required',
  'awaiting_owner',
  'approved',
  'rejected',
]);
export type ApprovalState = z.infer<typeof ApprovalState>;

/** Moderation gate before anything publishes under a business's name (§8). */
export const ModerationState = z.enum([
  'pending',
  'passed',
  'blocked',
]);
export type ModerationState = z.infer<typeof ModerationState>;

/**
 * The trust ramp (§8). Every customer starts at `approve_all`. The Operator
 * checks this before every publish. `full_auto` is opt-in, earned.
 */
export const TrustLevel = z.enum([
  'approve_all',
  'auto_low_risk',
  'full_auto',
]);
export type TrustLevel = z.infer<typeof TrustLevel>;

/** Risk classification that drives approval gating regardless of trust tier. */
export const RiskLevel = z.enum(['low', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Media stored in R2 (§5 media_assets). Owner-supplied is preferred over AI. */
export const MediaKind = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKind>;

export const MediaSource = z.enum(['owner_upload', 'ai_generated', 'assembled']);
export type MediaSource = z.infer<typeof MediaSource>;
