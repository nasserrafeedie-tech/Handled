export const PUBLISH_QUEUE = 'publish';

export interface PublishJobData {
  postId: string;
  customerId: string;
}

/**
 * Deterministic jobId so scheduling a post is idempotent (§12).
 * Note the hyphen: BullMQ rejects custom job ids containing ":" (it reserves
 * the colon for its own Redis key namespacing), and the rejection surfaces
 * only at enqueue time — i.e. every publish would fail.
 */
export const publishJobId = (postId: string) => `publish-${postId}`;
