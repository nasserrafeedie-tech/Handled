import type { BrandProfile, PlaybookArchetype, Post } from '@prisma/client';
import { formatInZone } from '../common/time';

/**
 * "What are you actually doing for me?"
 *
 * Handled's promise is no dashboard — but that shouldn't mean no visibility.
 * An owner paying every month deserves to see the plan without logging into
 * anything, so the strategy is legible over the same channel as everything
 * else: a text. Short enough to read on a phone, specific enough to prove
 * there's a real plan behind it.
 */

const list = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? (v as unknown[]).slice(0, max).map(String) : [];

/**
 * Below this, a match is a guess. Showing an arcade bar a strategy about axe
 * throwing is worse than showing it nothing — so weak matches stay silent
 * and the owner just sees their own profile back.
 */
const SHOW_ARCHETYPE_ABOVE = 0.75;

export interface StrategyView {
  profile: BrandProfile | null;
  archetype: PlaybookArchetype | null;
  /** Classifier confidence for this customer's attachment, not the row's. */
  archetypeConfidence?: number | null;
  businessName: string | null;
  timezone: string;
  upcoming: Pick<Post, 'caption' | 'scheduledTime' | 'status'>[];
  postedLast30: number;
}

/**
 * The owner-facing summary. Deliberately about THEM — their voice, their
 * cadence, what's scheduled — not about the machinery. No archetype slugs,
 * no confidence scores; those are operator concepts.
 */
export function strategySummary(v: StrategyView): string {
  const { profile, archetype, businessName } = v;
  if (!profile?.businessType) {
    return (
      "We haven't finished setting up your profile yet — tell me about your " +
      'business and I\'ll get your plan going.'
    );
  }

  const lines: string[] = [
    `Here's your plan ✳`,
    `${businessName ? `${businessName} — ` : ''}${profile.businessType}`,
  ];

  if (profile.voiceTone) lines.push(`Voice: ${profile.voiceTone}`);
  if (profile.targetCustomer) lines.push(`Reaching: ${profile.targetCustomer}`);
  lines.push(`${profile.postingFrequency ?? 3} posts a week`);

  // What we're leaning on, in plain words — only when the match is solid.
  const trusted =
    archetype != null && (v.archetypeConfidence ?? 0) >= SHOW_ARCHETYPE_ABOVE;
  const pillars = trusted ? list(archetype?.pillars, 3) : [];
  if (pillars.length) {
    lines.push('', `What I post about: ${pillars.join(', ')}`);
  }
  const discovery = trusted ? list(archetype?.discovery, 2) : [];
  if (discovery.length) {
    lines.push(`How locals find you: ${discovery.join('; ')}`);
  }

  if (v.upcoming.length) {
    lines.push('', 'Coming up:');
    // Time order, so the very next post is always the first line. A draft
    // waiting on their OK says so; putting those first used to push the next
    // scheduled post off the list when three or more were waiting.
    const SHOW = 4;
    const shown = v.upcoming.slice(0, SHOW);
    for (const p of shown) {
      const when = p.scheduledTime
        ? formatInZone(p.scheduledTime, v.timezone)
        : 'soon';
      const preview = (p.caption ?? '').replace(/\s+/g, ' ').slice(0, 60);
      const ask = p.status === 'pending_approval' ? ' (waiting on your OK)' : '';
      lines.push(`· ${when} — "${preview}${preview.length >= 60 ? '…' : ''}"${ask}`);
    }
    const rest = v.upcoming.slice(SHOW);
    if (rest.length) {
      const waiting = rest.filter((p) => p.status === 'pending_approval').length;
      lines.push(
        `· and ${rest.length} more` +
          (waiting ? ` (${waiting === rest.length && waiting > 1 ? 'all' : waiting} waiting on your OK)` : ''),
      );
    }
  }

  if (v.postedLast30 > 0) {
    lines.push('', `${v.postedLast30} posts went out in the last 30 days.`);
  }

  lines.push('', 'Want anything changed? Just tell me.');
  return lines.join('\n');
}
