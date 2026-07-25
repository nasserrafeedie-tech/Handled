/**
 * What each plan tier includes — the ONE place that answers it.
 *
 * The engine gates carousels, generated images and reels in code (a Starter
 * customer physically cannot get them). But those gates were the whole story:
 * nothing told the concierge what a tier *excludes*, so it could cheerfully
 * promise a Starter customer a carousel that the handler would then silently
 * refuse. Promised in conversation, absent in delivery, nothing logged wrong.
 *
 * This module is that missing half. The concierge reads it to know what it may
 * offer and what to decline-and-pitch; the upgrade reply reads it so the pitch
 * names the actual reason to upgrade. Keeping it beside `tierHasCarousel` and
 * friends means the sales copy and the gates can never drift apart — change a
 * gate, this changes with it.
 */

export type Tier = 'starter' | 'growth' | 'pro';

/** A gated capability the customer might ask for by name. */
export type Feature = 'carousel' | 'image' | 'reel' | 'video_upload';

const RANK: Record<Tier, number> = { starter: 0, growth: 1, pro: 2 };

/**
 * The lowest tier that includes each feature. Mirrors the code gates exactly.
 *
 * Reels (and the video uploads that feed them) are the Pro differentiator, not
 * Growth: they are the flashiest, most expensive treatment to produce and are
 * occasional by nature, so they are what a customer climbs to Pro *for*. Making
 * them Pro-exclusive is what gives Growth→Pro a real reason to exist beyond
 * "more posts a week" — carousels and images already anchor Starter→Growth.
 */
const REQUIRES: Record<Feature, Tier> = {
  carousel: 'growth',
  image: 'growth',
  reel: 'pro',
  video_upload: 'pro',
};

/** How to name each feature to a shop owner — no jargon. */
export const FEATURE_LABEL: Record<Feature, string> = {
  carousel: 'swipeable carousels',
  image: 'custom generated images',
  reel: 'reels cut from your clips',
  video_upload: 'video uploads',
};

const norm = (t: string): Tier => (t in RANK ? (t as Tier) : 'starter');

/**
 * How many platforms each tier may connect at once.
 *
 * There are five platforms (Instagram, Facebook, TikTok, Threads, Google
 * Business Profile). Starter gets the essential pair a local shop needs to be
 * found — Instagram + Google — while Growth reaches almost everywhere and Pro
 * reaches all of them.
 *
 * This was previously only advertised on the pricing page and NOT enforced —
 * any customer could connect all five. Adding Google Business Profile made that
 * gap matter (it is the channel worth gating), so the allowance is now real,
 * checked at connect time. Platform count is a secondary upgrade lever, not the
 * hero of any tier jump (carousels sell Growth, reels sell Pro), which is why
 * Starter can afford a generous two.
 */
const PLATFORM_LIMIT: Record<Tier, number> = {
  starter: 2,
  growth: 4,
  pro: 5,
};

/** How many platforms this tier may connect. */
export function platformLimit(planTier: string): number {
  return PLATFORM_LIMIT[norm(planTier)];
}

/**
 * Posts per week each tier includes — the 3 → 5 → 7 ladder the pricing page
 * sells (Starter 3, Growth 5, Pro daily). This is the cadence a plan is *paid*
 * for, so it is both the cap we plan to and the number onboarding should offer.
 * Without it the interview cheerfully accepted "4 a week" from a Starter whose
 * plan is 3, and the planner drafted all four — delivering more than was sold.
 */
const POSTS_PER_WEEK: Record<Tier, number> = {
  starter: 3,
  growth: 5,
  pro: 7,
};

/** How many posts a week this tier includes (and is capped at). */
export function postsPerWeek(planTier: string): number {
  return POSTS_PER_WEEK[norm(planTier)];
}

/**
 * Whether a customer may connect `platform`, given what they already have.
 *
 * Reconnecting a platform already on the list never counts against the limit —
 * re-authing an expired Instagram token must not be refused because the account
 * is "full". Only a genuinely new platform consumes a slot.
 */
export function canConnectPlatform(
  planTier: string,
  alreadyConnected: readonly string[],
  platform: string,
): boolean {
  if (alreadyConnected.includes(platform)) return true;
  return alreadyConnected.length < platformLimit(planTier);
}

/** Does this tier include this feature? */
export function tierHas(planTier: string, f: Feature): boolean {
  return RANK[norm(planTier)] >= RANK[REQUIRES[f]];
}

/** The lowest tier that unlocks a feature — for "that's a Growth feature". */
export function tierFor(f: Feature): Tier {
  return REQUIRES[f];
}

/**
 * One line for the drafting/concierge prompt describing exactly what this
 * customer's plan does and does not include — so the model never offers what
 * the engine will refuse. Written in the owner's terms.
 */
export function entitlementLine(planTier: string): string {
  const tier = norm(planTier);
  const has: Feature[] = [];
  const missing: Feature[] = [];
  (Object.keys(REQUIRES) as Feature[]).forEach((f) =>
    (tierHas(tier, f) ? has : missing).push(f),
  );

  if (missing.length === 0) {
    return `Plan ${tier}: includes everything — carousels, generated images, reels and video are all on.`;
  }
  const label = (fs: Feature[]) => fs.map((f) => FEATURE_LABEL[f]).join(', ');
  const next = tierFor(missing[0]);
  return (
    `Plan ${tier}: INCLUDES captions and the owner's own photos` +
    (has.length ? `, plus ${label(has)}` : '') +
    `. Does NOT include ${label(missing)} — those need ${next}. ` +
    `If they ask for one, do not promise it: say it's a ${next} feature and ` +
    `offer to bump them up. Never claim to have made something this plan excludes.`
  );
}

/**
 * The upgrade pitch, led by the feature that actually drives each jump.
 *
 * Each step now has its own hero, which is the point of the packaging: Starter→
 * Growth is sold on carousels (the stated #1 reason to leave Starter), and
 * Growth→Pro is sold on reels — the flashy, Pro-exclusive treatment — not on
 * volume alone, which was too weak to move anyone up before.
 */
export function upgradePitch(planTier: string): string {
  const tier = norm(planTier);
  if (tier === 'starter') {
    return (
      'Growth adds swipeable carousels — the branded, multi-slide posts that ' +
      'get saved and shared most — plus custom generated images, more posts a ' +
      'week, up to three platforms, and hands-off posting for your routine content.'
    );
  }
  // On Growth already → Pro, led by reels (its exclusive hero) then autopilot.
  return (
    'Pro adds reels cut from your clips — the video posts the feed pushes hardest — ' +
    'plus daily posting across every platform and full autopilot, on top of ' +
    'everything in Growth.'
  );
}
