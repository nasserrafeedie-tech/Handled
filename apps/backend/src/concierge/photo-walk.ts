/**
 * The photo walk (§ engagement research, Aug 2026): one guided session where
 * the owner walks their business photographing a shot list, filling the photo
 * bank that makes every later post real instead of rendered.
 *
 * Why a LIST and not "send some pictures": left alone, owners photograph the
 * one thing that doesn't engage — the empty storefront. The list extracts
 * exactly what the data rewards: faces (+38% likes), hands at work, process,
 * transformation, the details customers notice. The awkward prompts matter
 * most; "a photo of you" is the shot they skip unless asked twice, and the
 * highest-value one in the bank.
 *
 * Every shot has a stable `key`, stored on MediaAsset.subject at upload, so
 * the drafter can later pick "the owner's face" or "a before" on purpose.
 */

export interface Shot {
  /** Stable identifier, stored as MediaAsset.subject. */
  key: string;
  /** The ask, short, shown as the checklist row title. */
  title: string;
  /** Why / how — one warm line under the title. */
  hint: string;
}

/** The shots every business gets, in walk order — faces and work first. */
const CORE: Shot[] = [
  {
    key: 'owner_face',
    title: 'You, at your business',
    hint: "Yes, you. Posts with a real face get roughly double the response — this is the most valuable photo on this list.",
  },
  {
    key: 'hands_at_work',
    title: 'Your hands doing the work',
    hint: 'Mid-task, not posed. The thing you do a hundred times a day.',
  },
  {
    key: 'team',
    title: "Whoever's working today",
    hint: 'One photo per person is even better — customers pick people, not businesses.',
  },
  {
    key: 'todays_best',
    title: "Today's best result",
    hint: "The job, plate, cut, or piece you're proudest of right now.",
  },
  {
    key: 'before',
    title: "A 'before' you'd never post",
    hint: 'The messy start. Paired with an after, this is the highest-performing post there is.',
  },
  {
    key: 'tool',
    title: 'The tool you touch most',
    hint: 'Close up. Worn is good — worn reads as experience.',
  },
  {
    key: 'detail',
    title: 'The little thing customers notice',
    hint: 'The corner, texture, or touch people always comment on or photograph.',
  },
  {
    key: 'workspace',
    title: 'Where the work happens',
    hint: 'Your bench, chair, counter, or bay — as it really looks mid-day.',
  },
];

/** Vertical-specific swaps/additions, matched loosely on the business type. */
const VERTICAL: Array<{ match: RegExp; shots: Shot[] }> = [
  {
    match: /dent|ortho|medical|clinic|chiro|vet/i,
    shots: [
      { key: 'todays_best', title: 'A result you can show', hint: 'A smile, an x-ray win, a happy patient moment (with their OK).' },
      { key: 'comfort', title: 'The thing that makes visits easier', hint: 'The blanket, the headphones, the kids corner — whatever calms nerves.' },
    ],
  },
  {
    match: /caf|coffee|bak|restaurant|food|pizz|taco|deli|bar\b/i,
    shots: [
      { key: 'todays_best', title: "Today's best-looking plate or pour", hint: 'Shot from above or straight on, close enough to want.' },
      { key: 'process', title: 'Something mid-make', hint: 'Dough proofing, espresso pulling, the flat-top mid-rush.' },
    ],
  },
  {
    match: /salon|barber|nail|lash|brow|spa|beaut/i,
    shots: [
      { key: 'before', title: 'A before, chair-side', hint: 'Ask the client first — before/after pairs are gold in this trade.' },
      { key: 'station', title: 'Your station, set up for the day', hint: 'Clean tools lined up read as craft.' },
    ],
  },
  {
    match: /detail|wash|clean|maid|janitor/i,
    shots: [
      { key: 'before', title: 'The filthiest before you have', hint: 'The worse it looks, the better the after lands.' },
      { key: 'process', title: 'Mid-job suds or extraction', hint: 'The satisfying middle — foam, steam, the dirty water.' },
    ],
  },
  {
    match: /gym|fit|train|yoga|pilates|crossfit/i,
    shots: [
      { key: 'team', title: 'A coach mid-session', hint: 'Coaching, spotting, demonstrating — energy over posing.' },
      { key: 'community', title: 'The room when class is on', hint: 'People choosing a gym are buying the room\'s energy.' },
    ],
  },
];

/** The walk for one business: core list with vertical swaps merged in. */
export function shotListFor(businessType: string | null | undefined): Shot[] {
  const shots = [...CORE];
  const vertical = VERTICAL.find((v) => v.match.test(businessType ?? ''));
  if (vertical) {
    for (const s of vertical.shots) {
      const i = shots.findIndex((c) => c.key === s.key);
      if (i >= 0) shots[i] = s;
      else shots.push(s);
    }
  }
  return shots;
}

/**
 * Which walk subjects fit which post archetype, best first. This is what
 * turns the bank from "a pile of photos" into "the RIGHT photo for this
 * post": a behind-the-scenes post gets hands at work, a team post gets
 * faces, an educational tip gets the tool — never the storefront on
 * everything because it happened to be uploaded first.
 */
export function subjectPreferences(archetype: string): string[] {
  switch (archetype) {
    case 'behind_the_scenes':
      return ['hands_at_work', 'process', 'workspace', 'tool', 'station', 'owner_face'];
    case 'team_spotlight':
    case 'staff':
      return ['team', 'owner_face', 'hands_at_work', 'community'];
    case 'testimonial':
      return ['owner_face', 'team', 'todays_best', 'community'];
    case 'product_spotlight':
    case 'promo':
      return ['todays_best', 'detail', 'process', 'hands_at_work'];
    case 'educational_tip':
      return ['tool', 'hands_at_work', 'detail', 'process', 'todays_best'];
    case 'transformation':
      return ['before', 'todays_best'];
    case 'seasonal':
    case 'community':
      return ['owner_face', 'community', 'workspace', 'detail'];
    default:
      return ['todays_best', 'owner_face', 'hands_at_work', 'detail', 'workspace'];
  }
}

/** The kickoff text, sent once onboarding wraps. */
export function photoWalkInvite(siteUrl: string, customerId: string): string {
  return (
    'One more thing — the single biggest upgrade to your posts is real ' +
    'photos. Next time you\'re at the shop, do the 10-minute photo walk: ' +
    `${siteUrl}/photo-walk?c=${customerId} — it's a short checklist ` +
    '(you, your hands working, today\'s best). Posts made from your real ' +
    'photos get roughly double the response of anything designed.'
  );
}

/** The nudge, for a quiet bank a few days later. */
export function photoWalkReminder(siteUrl: string, customerId: string): string {
  return (
    'Quick nudge on the photo walk ✳ 10 minutes next time you\'re in: ' +
    `${siteUrl}/photo-walk?c=${customerId} — your next posts get built ` +
    'from whatever you send.'
  );
}
