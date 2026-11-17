import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { feedMetrics } from './feed-metrics';

/** Field names per platform, as Post for Me's SDK types them. */
describe('feedMetrics reads each platform in its own words', () => {
  it('Instagram: views, likes, comments, shares, saved', () => {
    assert.deepEqual(feedMetrics({ views: 500, reach: 300, likes: 20, comments: 4, shares: 1, saved: 6 }),
      { impressions: 500, likes: 20, comments: 4, shares: 1, saves: 6 });
  });
  it('Instagram with no views falls back to reach', () => {
    assert.equal(feedMetrics({ reach: 300 }).impressions, 300);
  });
  it('TikTok (personal and business)', () => {
    assert.deepEqual(feedMetrics({ view_count: 900, like_count: 70, comment_count: 5, share_count: 8 }),
      { impressions: 900, likes: 70, comments: 5, shares: 8, saves: 0 });
    assert.deepEqual(feedMetrics({ video_views: 900, likes: 70, comments: 5, shares: 8, favorites: 11 }),
      { impressions: 900, likes: 70, comments: 5, shares: 8, saves: 11 });
  });
  it('Facebook: media_views and reactions_total', () => {
    assert.deepEqual(feedMetrics({ media_views: 400, reactions_total: 12, comments: 2, shares: 1 }),
      { impressions: 400, likes: 12, comments: 2, shares: 1, saves: 0 });
  });
  it('X: counts nested under public_metrics', () => {
    assert.deepEqual(feedMetrics({ public_metrics: { impression_count: 80, like_count: 3, reply_count: 1, retweet_count: 2, bookmark_count: 4 } }),
      { impressions: 80, likes: 3, comments: 1, shares: 2, saves: 4 });
  });
  it('missing, null or junk metrics are zeros, never NaN', () => {
    assert.deepEqual(feedMetrics(null), { impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
    assert.deepEqual(feedMetrics({ views: 'lots', likes: null }), { impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
  });
});
