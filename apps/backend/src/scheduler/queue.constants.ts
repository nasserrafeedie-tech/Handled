export const PUBLISH_QUEUE = 'publish';

export interface PublishJobData {
  postId: string;
  customerId: string;
}

/**
 * The heavy-video queue. Reel assembly (ffmpeg on 4K/HDR footage) needs far
 * more memory than serving a text, and running it in the web process is what
 * took the whole service down. Jobs land here and are consumed ONLY by the
 * dedicated worker service, so the web instance stays light and a runaway
 * render can never crash the customer-facing side.
 */
export const REEL_QUEUE = 'reel';

export interface ReelJobData {
  customerId: string;
  platform: string;
  /**
   * Cut from these specific clips instead of the customer's unclaimed banked
   * video. Lets an operator re-cut the SAME footage after an edit-logic change
   * (banked clips get claimed by the first reel), without a re-upload.
   */
  mediaAssetIds?: string[];
  /**
   * An animated reel (ANIMATED_REEL) instead of a cut of footage. Same queue,
   * because the frames are drawn on the CPU for ~20-60s and must never block
   * the web process's event loop.
   */
  /**
   * Made by the Monday plan, not asked for: its own job slot (so it never
   * replaces a reel the owner asked for) and quiet unless nothing else waits.
   */
  weekly?: boolean;
  animated?: {
    kind: 'promo' | 'before_after';
    offerText?: string;
    mediaAssetIds?: string[];
  };
}

/**
 * One pending reel per customer. Two uploads in quick succession shouldn't cut
 * two reels; same customerId → same jobId → the later enqueue replaces the
 * earlier pending one. Hyphen, not colon (BullMQ reserves ":").
 */
export const reelJobId = (customerId: string, animated = false, weekly = false) =>
  weekly ? `reel-weekly-${customerId}` : animated ? `reel-anim-${customerId}` : `reel-${customerId}`;

/**
 * Deterministic jobId so scheduling a post is idempotent (§12).
 * Note the hyphen: BullMQ rejects custom job ids containing ":" (it reserves
 * the colon for its own Redis key namespacing), and the rejection surfaces
 * only at enqueue time — i.e. every publish would fail.
 */
export const publishJobId = (postId: string) => `publish-${postId}`;
