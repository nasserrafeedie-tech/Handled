import type { PlaybookArchetype } from '@prisma/client';

/**
 * Turn an archetype row into planning context for the LLM.
 *
 * The division of labour the engine spec sets out: the **archetype is
 * strategy** (what to post, which formats, what cadence, how locals find you),
 * the customer's **derived brand is voice**, and the existing approval flow
 * governs publishing. So this block deliberately carries no tone instructions —
 * it would fight the brand context that's already in the prompt.
 */

const list = (v: unknown, max = 8): string[] =>
  Array.isArray(v) ? (v as unknown[]).slice(0, max).map(String) : [];

export function archetypePlanningBlock(a: PlaybookArchetype): string {
  const lines = [
    `PROVEN STRATEGY FOR THIS KIND OF BUSINESS (${a.title}):`,
    `- Where it works: ${list(a.platforms, 4).join('; ')}`,
    `- What to post about: ${list(a.pillars).join('; ')}`,
    `- Formats that earn reach here: ${list(a.topFormats).join('; ')}`,
    `- Healthy rhythm: ${list(a.cadence, 3).join('; ')}`,
    `- Ideas proven in this trade: ${list(a.reels).join('; ')}`,
    `- How locals discover it: ${list(a.discovery, 5).join('; ')}`,
    `- Offers that convert: ${list(a.offers, 5).join('; ')}`,
    `- Seasonal beats: ${list(a.seasonal, 5).join('; ')}`,
    `- Avoid: ${list(a.mistakes, 5).join('; ')}`,
    `- What success looks like: ${a.revenueMetric}`,
  ];

  // A freshly-researched archetype is new knowledge — say so, so the planner
  // stays conservative on its first outings (engine guardrails).
  if (a.status !== 'seed' && a.confidence < 0.75) {
    lines.push(
      '- NOTE: this strategy is newly researched and unproven. Favour safe,' +
        ' clearly-useful posts over clever experiments.',
    );
  }
  return lines.join('\n');
}

/** Photo asks worth texting an owner, drawn from the archetype's photo style. */
export function archetypePhotoGuidance(a: PlaybookArchetype): string {
  return `Photos for this trade should look like: ${a.photoStyle}`;
}

/** Caption opening patterns that earn saves and shares in this trade. */
export function archetypeCaptionHooks(a: PlaybookArchetype): string[] {
  return list(a.captionHooks, 6);
}
