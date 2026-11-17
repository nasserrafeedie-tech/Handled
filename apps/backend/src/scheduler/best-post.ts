/**
 * The line in the Friday check-in that shows the owner the work paid off.
 * "2 posts went out" proves we did something; "your Tuesday post got 1,500
 * views" proves it mattered, and that is what keeps a small business paying.
 *
 * Only real numbers from the metrics table. No metrics, or nothing above zero,
 * means no line, never an estimate.
 */
export interface RecapPost {
  caption: string | null;
  publishedAt: Date | null;
  impressions: number;
  likes: number;
  saves: number;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** First few words of the caption, cut at a word, so the owner knows which post. */
export function captionHint(caption: string | null, words = 6): string {
  const first = (caption ?? '').split('\n')[0].replace(/\s+/g, ' ').trim();
  if (!first) return '';
  const parts = first.split(' ');
  const cut = parts.slice(0, words).join(' ').replace(/[,;:.!?…—-]+$/, '');
  return parts.length > words ? `${cut}…` : cut;
}

export function bestPostLine(posts: RecapPost[], timeZone: string): string | null {
  const scored = posts.filter((p) => p.impressions > 0 || p.likes > 0 || p.saves > 0);
  if (!scored.length) return null;
  const best = [...scored].sort(
    (a, b) => b.impressions - a.impressions || b.saves - a.saves || b.likes - a.likes,
  )[0];
  const day = best.publishedAt
    ? best.publishedAt.toLocaleDateString('en-US', { weekday: 'long', timeZone })
    : null;
  const hint = captionHint(best.caption);
  const which = [day ? `${day}'s post` : 'Your top post', hint ? `("${hint}")` : '']
    .filter(Boolean)
    .join(' ');
  const stats = [
    best.impressions ? `${fmt(best.impressions)} views` : null,
    best.saves ? `${fmt(best.saves)} saves` : null,
    !best.impressions && best.likes ? `${fmt(best.likes)} likes` : null,
  ].filter(Boolean);
  return `Best one: ${which} with ${stats.join(' and ')}.`;
}
