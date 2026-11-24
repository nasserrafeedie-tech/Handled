import type { Result } from '@smm/contracts';
import type { ReelJobData } from './queue.constants';

/** An offer worth animating names a price, a discount or something free. */
const PRICED = /[$€£]\s?\d|\d+\s?%|\bfree\b/i;

/**
 * Which of the owner's own offers gets this week's promo reel. Priced offers
 * first (a promo with nothing to sell is a slideshow), turning through them a
 * week at a time so the same special isn't animated every Monday. Null when the
 * profile has no offers: the reel's words come only from what the owner gave,
 * so with nothing given there is no reel.
 */
export function weeklyPromoOffer(offers: readonly string[] | null | undefined, week: number): string | null {
  const all = (offers ?? []).map((o) => o.trim()).filter(Boolean);
  if (!all.length) return null;
  const priced = all.filter((o) => PRICED.test(o));
  const pool = priced.length ? priced : all;
  return pool[((week % pool.length) + pool.length) % pool.length];
}

/** Weeks since the epoch, Monday-based, for turning through offers. */
export function weekNumber(at: Date): number {
  // 1970-01-05 was a Monday.
  return Math.floor((at.getTime() - Date.UTC(1970, 0, 5)) / (7 * 86_400_000));
}

/**
 * What to text the owner when a reel job finishes, or null for nothing.
 *
 * A reel the owner asked for always gets its answer. A weekly reel nobody
 * asked for stays quiet unless it's the only thing waiting: behind the week's
 * drafts it comes up for its yes in turn, like any other draft, and a failure
 * is ours to log, not theirs to hear about.
 */
export function reelNotice(
  job: Pick<ReelJobData, 'weekly'>,
  result: Pick<Result, 'status' | 'summary_for_owner' | 'data'>,
): { text: string; promptedByOwner: boolean } | null {
  if (!job.weekly) return { text: result.summary_for_owner, promptedByOwner: true };
  if (result.status !== 'pending_approval') return null;
  const ahead = (result.data as { waiting_ahead?: number } | null)?.waiting_ahead;
  return ahead === 0 ? { text: result.summary_for_owner, promptedByOwner: false } : null;
}
