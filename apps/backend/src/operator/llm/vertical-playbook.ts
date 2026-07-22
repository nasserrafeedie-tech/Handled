/**
 * Per-vertical content strategy — what actually earns engagement for each kind
 * of local business, researched July 2026. This is the product's "taste": the
 * planner uses it to pick the right week, the writer to draft the right post,
 * and the shot-list system to ask for the right photo or clip.
 *
 * Research distilled (sources in git history):
 *  - UGC/authentic beats polished ~5x on trust; a customer's blurry photo can
 *    outsell a studio shot. Ask owners for REAL moments, not staged ones.
 *  - The scroll decision happens in ~1.7s: every reel needs a text hook ON the
 *    first frame (our engine already overlays it).
 *  - Beauty: before/after transformations are the #1 converter; educational
 *    40% / behind-scenes 30% / results 20% mix.
 *  - Food: POV + behind-the-scenes wins (4am bakehouse > plated glamour);
 *    carousels for menus and saves; weekly specials posted Monday.
 *  - Fitness: form tips + genuine member transformations earn saves; series
 *    habits ("Monday mobility") build return viewers.
 *  - Retail: "what walked in this week" + how-to-style across real bodies;
 *    honesty converts better than flattery.
 */

export interface VerticalPlay {
  key: string;
  match: RegExp;
  /** One line the planner reads about the right weekly mix. */
  mix: string;
  /** Post ideas that reliably perform — the writer picks from these. */
  ideas: string[];
  /** Photo asks that produce usable, authentic shots. */
  photoAsks: string[];
  /** The 3-clip reel recipe + a hook that fits it. */
  reelClips: [string, string, string];
  reelHook: string;
}

const V = (p: VerticalPlay) => p;

export const VERTICALS: VerticalPlay[] = [
  V({
    key: 'coffee',
    match: /coffee|cafe|café|espresso|roaster|tea ?house/i,
    mix: 'Lead with behind-the-scenes and POV moments; one weekly-specials post each Monday; save-bait like hours/menu as carousels.',
    ideas: [
      'POV: the first pour of the morning (steam, latte art, no talking)',
      'Monday post of this week\'s special drink with its real price',
      'The 6am opening routine nobody sees',
      'Meet the regular: their usual order and their story (with permission)',
      'How we dial in a new bag of beans — 20-second process clip',
      'Rainy-day post: the corner table + what to order with a book',
    ],
    photoAsks: [
      'the drink you\'re proudest of today, on the counter, natural light',
      'your hands mid-pour — messy apron welcome',
      'the line or the room when it feels alive',
    ],
    reelClips: [
      'the espresso machine pulling a shot, close up',
      'milk pour into the cup, top-down',
      'handing the cup across the counter to a smiling customer',
    ],
    reelHook: 'The first pour of the morning',
  }),
  V({
    key: 'bakery',
    match: /bakery|baker|pastry|patisserie|bread|donut|cake/i,
    mix: 'The 4am reality is content gold — early bakehouse footage outperforms plated glamour. Transformations (bare cake → finished) are the top reel.',
    ideas: [
      'The 4am bakehouse: flour dust, first trays, no filter',
      'Bare cake to finished cake in 20 seconds',
      'What sold out first today (post at sell-out time)',
      'Lamination close-up: the croissant fold ASMR',
      'This week\'s bake schedule as a save-able carousel/card',
    ],
    photoAsks: [
      'the morning\'s first tray coming out of the oven',
      'your hands shaping dough — flour everywhere is the point',
      'the case right after opening, fully stocked',
    ],
    reelClips: [
      'dough being shaped or rolled, hands in frame',
      'trays going into or out of the oven',
      'the finished case or a customer picking their pastry',
    ],
    reelHook: 'While you were sleeping',
  }),
  V({
    key: 'restaurant',
    match: /restaurant|taqueria|taco|kitchen|bistro|diner|pizza|grill|bbq|sushi|ramen|food truck/i,
    mix: 'Behind-the-scenes and plate-building POV drive ~2x engagement; menu reveals as carousels; weekly special every Monday with quantity for urgency.',
    ideas: [
      'POV: building the signature dish start to finish',
      'Monday special drop — name the dish, the price, and how many you\'ll make',
      'The walk-in at 7am: what fresh looks like',
      'Kitchen sounds only: the sear, no music',
      'Staff pick: what the cooks actually eat after close',
    ],
    photoAsks: [
      'your best-selling plate the second it\'s finished, before it goes out',
      'the kitchen mid-service — motion blur welcome',
      'the room when it\'s full and warm',
    ],
    reelClips: [
      'raw ingredients being prepped, close on the hands',
      'the loudest cooking moment — sear, flip, pour',
      'the finished plate landing on the table',
    ],
    reelHook: 'How the favorite gets made',
  }),
  V({
    key: 'beauty',
    match: /salon|hair|stylist|beauty|nail|lash|brow|barber|barbershop|shave|grooming/i,
    mix: 'Before/after transformation is the #1 converter. Mix: ~40% educational (tips clients save), ~30% behind-the-scenes/team, ~20% client results. Under 30s reels reach non-followers best.',
    ideas: [
      'Before → after transformation with the client\'s reaction as the ending',
      '"Products I used for this look" — educational save-bait',
      'The satisfying bit: fade lines, gloss rinse, polish top-coat ASMR',
      'One tip clients always ask about (answer it in 15 seconds)',
      'Chair POV: what a first visit actually feels like',
    ],
    photoAsks: [
      'a before AND after of today\'s best work, same angle both times',
      'your station set up and ready in the morning',
      'a client mid-laugh in the chair (with their OK)',
    ],
    reelClips: [
      'the "before" — client seated, phone at the same height as their face',
      'the work itself: cutting, coloring, or shaping close up',
      'the reveal — client seeing the mirror for the first time',
    ],
    reelHook: 'Wait for the reveal',
  }),
  V({
    key: 'wellness',
    match: /spa|massage|wellness|yoga|pilates|meditation|acupunct|facial|skincare/i,
    mix: 'Calm is the brand: room ambience, ritual close-ups, one educational post a week that clients save. No hard sells — the atmosphere converts.',
    ideas: [
      'The room being prepared: towels, oil, light — 15 quiet seconds',
      'One tension-relief tip to try at your desk (save-bait)',
      'What a first visit includes, step by step (carousel)',
      'The sound of the space: water, quiet, breath',
    ],
    photoAsks: [
      'the treatment room the moment it\'s ready',
      'a detail: stones, towels, oil bottles in your light',
      'the entrance that makes people exhale',
    ],
    reelClips: [
      'hands preparing the space — towels, candles, oil',
      'the calmest wide shot of the room',
      'one small ritual detail in motion (steam, pouring, folding)',
    ],
    reelHook: 'Your hour of quiet, being prepared',
  }),
  V({
    key: 'fitness',
    match: /gym|fitness|crossfit|training|athletic|boxing|martial|barre|cycle|swim/i,
    mix: 'Form tips + genuine member wins earn the saves. Series build habits ("Monday mobility"). 30-60s reels; post 5-7am and 5-7pm when members scroll.',
    ideas: [
      'The #1 mistake people make on [a common exercise] — and the fix',
      'Member spotlight: real progress, real timeline, their words',
      'One 30-second mobility drill for desk workers (save-bait series)',
      '5am crew appreciation post — the people who show up',
      'What a first session here actually looks like (nerves welcome)',
    ],
    photoAsks: [
      'a member mid-effort who\'s OK being featured — real strain, real face',
      'the space at golden hour or under the morning lights',
      'chalk, ropes, plates — one gritty detail up close',
    ],
    reelClips: [
      'the room filling up or a class starting',
      'one clean rep of an exercise, side angle',
      'a member finishing — the exhale, the fist bump',
    ],
    reelHook: 'The 6am club',
  }),
  V({
    key: 'florist',
    match: /flower|floral|florist|bouquet|garden|plant|nursery/i,
    mix: 'Process is the product: arrangement time-lapses and market-fresh mornings. Seasonal urgency is honest urgency — peonies really do leave in 3 weeks.',
    ideas: [
      'Bouquet built in 30 seconds, time-lapse, hands in frame',
      'What came in from the market this morning',
      'This week only: the seasonal stem and when it disappears',
      'Care tip carousel: make your bouquet last twice as long (save-bait)',
      'The order wall on a wedding weekend',
    ],
    photoAsks: [
      'this morning\'s delivery buckets, just unwrapped',
      'your hands mid-arrangement',
      'the finished piece in your best window light',
    ],
    reelClips: [
      'stems being unwrapped or trimmed',
      'the arrangement coming together, sped up',
      'the finished bouquet, slow turn in the light',
    ],
    reelHook: 'From market to bouquet',
  }),
  V({
    key: 'retail',
    match: /book|shop|boutique|store|retail|gift|vintage|thrift|record|toy/i,
    mix: 'UGC converts ~6x brand content — repost customers relentlessly (with credit). "What walked in this week" reels turn stock into appointment viewing; honest styling beats flattery.',
    ideas: [
      '"What walked in this week" — new stock in 20 seconds',
      'Same item styled 3 ways / on 3 different people, no edits',
      'Customer repost with credit: "Tagged by @__, and now we can\'t stop staring"',
      'Staff pick of the week and the honest reason why',
      'The corner of the shop people photograph most',
    ],
    photoAsks: [
      'today\'s best new arrival, held up in natural light',
      'a customer\'s tagged photo you loved (screenshot it, we\'ll credit)',
      'the shopfront or window display right now',
    ],
    reelClips: [
      'the box or delivery being opened',
      'items being placed on shelves or a rack',
      'one favorite piece held up to the camera',
    ],
    reelHook: 'What walked in this week',
  }),
  V({
    key: 'services',
    match: /studio|photo|design|art|gallery|maker|ceramic|craft|pet|groom|veterinar|clean|repair|detail|landscap|contractor/i,
    mix: 'Before/after and process POV do the convincing; one educational post weekly builds authority. The transformation IS the ad.',
    ideas: [
      'Before → after of a real job, same angle both shots',
      'The most satisfying 15 seconds of the work itself',
      'One thing customers always get wrong (gentle, useful)',
      'The tools of the trade, laid out — people love the kit',
      'A finished job walkthrough with what it took',
    ],
    photoAsks: [
      'a true before/after pair, same angle and light',
      'your hands doing the most skilled part of the job',
      'the tools or workspace, honestly messy',
    ],
    reelClips: [
      'the "before" state, steady shot',
      'the most visual moment of the work',
      'the "after" reveal from the same angle as the before',
    ],
    reelHook: 'Watch this transformation',
  }),
];

const DEFAULT: VerticalPlay = {
  key: 'general',
  match: /./,
  mix: 'Authentic beats polished ~5x: real moments, real people, real details. One educational save-worthy post a week; one behind-the-scenes; repost customers with credit.',
  ideas: [
    'Behind the scenes of the part of the job customers never see',
    'One tip your customers always thank you for (save-bait)',
    'The story of one real customer interaction this week',
    'Your space at its best moment of the day',
  ],
  photoAsks: [
    'you or your team mid-work, candid over posed',
    'the detail of your space customers comment on',
    'today\'s best moment, whatever it was',
  ],
  reelClips: [
    'your storefront or space from outside',
    'the most visual moment of the work you do',
    'a happy customer moment or the finished result',
  ],
  reelHook: 'A little peek inside',
};

export function verticalFor(businessType: string | null | undefined): VerticalPlay {
  const d = businessType ?? '';
  return VERTICALS.find((v) => v.match.test(d)) ?? DEFAULT;
}

/**
 * Does this business have a place customers walk into?
 *
 * Most do, and every reel recipe opens by asking for a shot of it. Plenty do
 * not: agencies, consultants and online sellers have no premises at all, and the
 * mobile trades already in this playbook — locksmiths, movers, cleaners — travel
 * to the customer instead. Asking all of them to film "your storefront from
 * outside" is an instruction they cannot follow, and an ask nobody can complete
 * is worse than no ask: it stalls the whole reel.
 */
export function hasStorefront(businessType: string | null | undefined): boolean {
  return !/\b(?:agency|consultan|freelance|marketing|social media|online|e-?commerce|virtual|remote|mobile|traveling|travelling|we come to you|in-home|at-home|courier|delivery|locksmith|mover|moving|haul|cleaning service|landscap|plumb|electrician|handyman)\b/i.test(
    businessType ?? '',
  );
}

/**
 * The 3-clip recipe, with the storefront shot swapped out for something a
 * premises-free business can actually film. Only the opening clip assumes a
 * building; the other two — the work itself and the finished result — hold for
 * everyone.
 */
export function reelClipsFor(
  businessType: string | null | undefined,
  clips: readonly [string, string, string],
): [string, string, string] {
  if (hasStorefront(businessType)) return [...clips] as [string, string, string];
  return [
    'the tools, van or screen you actually work on — unglamorous is fine',
    clips[1],
    clips[2],
  ];
}

/** Prompt block for the weekly planner. */
export function planningGuidance(businessType: string | null | undefined): string {
  const v = verticalFor(businessType);
  return [
    `VERTICAL STRATEGY (${v.key}): ${v.mix}`,
    'Proven post ideas for this trade — plan slots around these, varied across the week:',
    ...v.ideas.map((i) => `- ${i}`),
  ].join('\n');
}

/** Prompt block for a single draft. */
export function draftGuidance(businessType: string | null | undefined): string {
  const v = verticalFor(businessType);
  return [
    `VERTICAL NOTES (${v.key}): ${v.mix}`,
    `If the archetype fits, draw on ideas like: ${v.ideas.slice(0, 3).join(' · ')}`,
  ].join('\n');
}

/** The per-customer strategy "file" shape stored in BrandProfile.contentStrategy. */
export interface CustomerStrategy {
  mix: string;
  ideas: string[];
  photo_asks: string[];
  reel_clips: [string, string, string];
  reel_hook: string;
}

/**
 * Bespoke first, playbook second. Each customer gets their own strategy file
 * written by Claude at onboarding from THEIR words; until it exists (or when
 * running free/offline) the researched vertical playbook fills in.
 */
export function resolveStrategy(profile: {
  businessType?: string | null;
  contentStrategy?: unknown;
}): CustomerStrategy {
  const cs = profile.contentStrategy as Partial<CustomerStrategy> | null | undefined;
  if (
    cs &&
    typeof cs.mix === 'string' &&
    Array.isArray(cs.ideas) &&
    cs.ideas.length >= 3 &&
    Array.isArray(cs.reel_clips) &&
    cs.reel_clips.length === 3
  ) {
    return {
      mix: cs.mix,
      ideas: cs.ideas as string[],
      photo_asks: (cs.photo_asks as string[]) ?? [],
      reel_clips: cs.reel_clips as [string, string, string],
      reel_hook: (cs.reel_hook as string) ?? 'A little peek inside',
    };
  }
  const v = verticalFor(profile.businessType);
  return {
    mix: v.mix,
    ideas: v.ideas,
    photo_asks: v.photoAsks,
    reel_clips: v.reelClips,
    reel_hook: v.reelHook,
  };
}

export function strategyPlanningBlock(s: CustomerStrategy): string {
  return [
    `CONTENT STRATEGY FOR THIS BUSINESS: ${s.mix}`,
    'Plan slots around these ideas, varied across the week:',
    ...s.ideas.map((i) => `- ${i}`),
  ].join('\n');
}
