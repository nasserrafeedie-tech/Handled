import type { PlatformMetrics } from './post-for-me.service';

/**
 * Post for Me returns each platform's own metric names on a feed item
 * (`GET /v1/social-account-feeds/{account}?expand=metrics`): Instagram says
 * `views` and `saved`, TikTok `view_count` or `video_views`, Facebook
 * `media_views` and `reactions_total`, X nests counts under `public_metrics`,
 * LinkedIn uses camelCase. These are the field names in Post for Me's own
 * TypeScript SDK (post-for-me 2.9.1, `PlatformPost.metrics`).
 *
 * Reading them into our five numbers here keeps one rule for every platform:
 * take the first field the platform actually sent, and never invent a number.
 * A metric no field covers is 0, which is what the weekly recap already
 * treats as "nothing to report".
 */
const PICK: Record<keyof PlatformMetrics, string[]> = {
  impressions: [
    'views', 'view_count', 'video_views', 'media_views', 'impressions', 'impressionCount',
    'public_metrics.impression_count', 'organic_metrics.impression_count', 'impression', 'reach',
  ],
  likes: ['likes', 'like_count', 'reactions_total', 'likeCount', 'public_metrics.like_count', 'reaction'],
  comments: ['comments', 'comment_count', 'replies', 'commentCount', 'public_metrics.reply_count', 'comment'],
  shares: ['shares', 'share_count', 'reposts', 'shareCount', 'public_metrics.retweet_count'],
  saves: ['saved', 'saves', 'favorites', 'save', 'public_metrics.bookmark_count'],
};

function read(obj: Record<string, unknown>, path: string): number | undefined {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : undefined;
}

export function feedMetrics(metrics: unknown): PlatformMetrics {
  const m = metrics && typeof metrics === 'object' ? (metrics as Record<string, unknown>) : {};
  const out = {} as PlatformMetrics;
  for (const [field, paths] of Object.entries(PICK) as [keyof PlatformMetrics, string[]][]) {
    out[field] = paths.map((p) => read(m, p)).find((v) => v !== undefined) ?? 0;
  }
  return out;
}
