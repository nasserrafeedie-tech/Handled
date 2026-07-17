export const PUBLISH_QUEUE = 'publish';

export interface PublishJobData {
  postId: string;
  customerId: string;
}

/** Deterministic jobId so scheduling a post is idempotent (§12). */
export const publishJobId = (postId: string) => `publish:${postId}`;
