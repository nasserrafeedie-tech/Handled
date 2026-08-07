/**
 * Turning a business and a post into a prompt for an image model.
 *
 * The whole risk of generated imagery sits in this file. A photo of "a cortado
 * on a worn wooden counter" is an illustration of what a coffee shop sells. The
 * same photo captioned as *their* counter, in *their* shop, is a customer
 * walking in expecting a room that does not exist. We only ever generate the
 * first kind, and the constraints below are what keep it there:
 *
 *   • never the business name, never the street, never "their" anything
 *   • no identifiable people — a generated face reads as staff or a customer
 *   • no text, letters, or signage — models garble it, and "spelled right" is
 *     the promise the whole product is sold on
 *   • no logos or brand marks
 *
 * The business name is deliberately never interpolated into a prompt. Not as
 * style guidance, not as context. If it is not in the string it cannot end up
 * in the image.
 */

export interface ImageBrief {
  /** What the business does — "coffee shop", "nail salon". Never its name. */
  businessType: string;
  /** Visual direction from the brand profile, if the owner gave one. */
  visualStyle?: string | null;
  /** The post this image accompanies, used only to pick a subject. */
  caption?: string | null;
  /** Brand colours, as hex. Used as a palette hint, never as a logo. */
  brandColors?: string[];
}

/** Appended to every prompt. Non-negotiable, and not derived from user input. */
const HARD_CONSTRAINTS = [
  'no text',
  'no words',
  'no letters',
  'no numbers',
  'no signage',
  'no logos',
  'no watermarks',
  'no faces',
  'no identifiable people',
];

/**
 * What the model must not produce. Kept separate from the prompt because most
 * image APIs take it as its own field, where it carries more weight than the
 * same words buried in the positive prompt.
 */
export const NEGATIVE_PROMPT = [
  'text, words, letters, numbers, captions, watermark, signature, logo, brand mark, signage, menu board',
  'human face, person, portrait, hands with visible detail, crowd',
  'room, interior, exterior, storefront, building, wide establishing shot, empty room',
  'deformed, distorted, extra fingers, malformed',
  'oversaturated, HDR, plastic, artificial-looking, stock-photo cliché',
].join(', ');

/**
 * Phrases that would turn an illustration into a claim. Checked rather than
 * trusted: the subject line is model-written, and a model asked for a subject
 * for "Rosa's Coffee" will happily write "Rosa's storefront" unless stopped.
 */
const OWNERSHIP_CLAIMS_SOURCE =
  String.raw`\b(?:our|their|the shop'?s|the owner'?s|this business(?:'s)?|storefront|shopfront|exterior|the salon'?s|the studio'?s)\b`;

// Built fresh at each use rather than shared. A /g/ regex carries lastIndex
// between calls, so a single shared instance would make .test() alternate
// true/false on identical input — the gate would pass every other subject.
const claimsRe = (flags = 'i') => new RegExp(OWNERSHIP_CLAIMS_SOURCE, flags);

/** Strip anything that asserts the image depicts a specific real place. */
export function stripOwnershipClaims(subject: string): string {
  let out = subject;
  // Repeat to a fixed point: removing one phrase can expose another
  // ("our storefront" leaves "storefront" behind after the first pass).
  for (let i = 0; i < 5; i++) {
    const next = out.replace(claimsRe('gi'), '');
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/**
 * Does this subject claim to depict a particular business? Used as a gate: a
 * subject that still reads as a claim after stripping is rejected rather than
 * quietly published.
 */
export function claimsSpecificPlace(subject: string): boolean {
  return claimsRe().test(subject);
}

/**
 * Words that mean the subject is a PLACE, not a thing.
 *
 * The line that matters: a photo of a product ("floss on a counter", "a shade
 * guide on a tray") is honest — it's the kind of thing the business uses. A
 * photo of a space ("a dental treatment room", "the dining area", "a modern
 * salon interior") reads as *their* premises, and generating one is a picture
 * of a place that doesn't exist. Those are always the owner's to photograph, so
 * a place-subject is refused and turned into a shot-list ask instead.
 *
 * "Counter", "table", "tray", "shelf" are surfaces a thing sits on, not rooms —
 * deliberately absent so ordinary product shots pass.
 */
const PLACE_SCENE_SOURCE = String.raw`\b(?:interior|exterior|storefront|shopfront|facade|façade|lobby|foyer|reception|entrance|entryway|hallway|corridor|room|operatory|premises|showroom|shopfloor|shop\s+floor|salon\s+floor|gym\s+floor|dining\s+(?:area|room|space)|seating\s+(?:area|space)|waiting\s+(?:area|room)|treatment\s+(?:area|room)|the\s+space|the\s+shop\b|the\s+salon\b|the\s+studio\b|the\s+gym\b|the\s+office\b|inside\s+the|indoors|storefit|building|dining\s+hall|wide\s+(?:shot|angle)|establishing\s+shot)\b`;
const placeRe = () => new RegExp(PLACE_SCENE_SOURCE, 'i');

/**
 * Does this subject depict a place rather than a thing? A place is the
 * business's space, which we never fabricate — those get a real-photo ask.
 */
export function depictsPlace(subject: string): boolean {
  return placeRe().test(subject);
}

/**
 * The single gate the generator asks before spending anything: refuse a subject
 * that either names a specific business or depicts a place. Both mean "ask the
 * owner for a real photo instead."
 */
export function shouldRefuseSubject(subject: string): boolean {
  return claimsSpecificPlace(subject) || depictsPlace(subject);
}

/**
 * Build the final prompt.
 *
 * `subject` is the only variable part — a short, concrete noun phrase for what
 * is in frame ("a cortado on a worn wooden counter"). Everything else is fixed
 * scaffolding, so a bad subject cannot widen what gets generated.
 */
export function buildImagePrompt(brief: ImageBrief, subject: string): string {
  const cleaned = stripOwnershipClaims(subject);

  const parts = [
    cleaned,
    // A close-up of the THING, not a view of a place. "in the setting of…"
    // used to invite a whole room, which produced fake premises — a dental
    // treatment room, a café interior. The business type is a category hint
    // for the props, not a scene to build.
    `the kind of thing an independent ${brief.businessType} sells or uses`,
    // Editorial still-life, NOT fake candid photography. A photoreal "candid"
    // pretends to be the business's own snapshot — exactly what consumers now
    // spot and distrust, and what platforms auto-label as AI. Deliberate art
    // direction reads as design, sits honestly beside real owner photos, and
    // still beats a flat text card.
    'a styled editorial still-life, the subject filling most of the frame',
    brief.visualStyle ? `${brief.visualStyle} styling` : 'clean, considered styling',
    'deliberate studio art direction: a simple color-blocked or softly ' +
      'graduated backdrop, controlled soft light, unhurried composition',
    'it should read as a designed magazine image, never as a candid phone ' +
      'photo of a real business',
    // The background must not become a place. A soft wash of light and colour,
    // never a readable room. This is what keeps the pixel-level place check
    // from rejecting an otherwise-fine still-life.
    'the background a soft indistinct wash of light and colour, with no ' +
      'recognizable room, window, furniture, fixtures, shelving, or architecture',
    'not a room, not an interior, not a building, not an establishing shot',
    ...HARD_CONSTRAINTS,
  ];

  return parts.filter(Boolean).join(', ');
}

/**
 * The instruction that asks a language model for a subject line. Separate from
 * the image prompt because the subject is chosen from the caption, and that
 * choice is where a claim would sneak in.
 */
export function subjectInstruction(brief: ImageBrief): string {
  return [
    `Pick the subject for a photograph to run alongside this social post for an independent ${brief.businessType}.`,
    brief.caption ? `The post says:\n"""\n${brief.caption}\n"""` : '',
    '',
    'Return JSON: {"subject": string} — one short noun phrase naming what is in the frame, under 15 words.',
    'Rules:',
    '- It must be a THING, shot close up — a product, tool, ingredient, or dish.',
    '  "A cortado on a worn wooden counter", "dental floss beside a toothbrush".',
    '- NEVER a place. No room, interior, treatment room, dining room, office,',
    '  waiting room, salon floor, storefront, exterior, or building. We ask the',
    '  owner for photos of their actual space — you only picture the things.',
    '- A generic example of what this kind of business sells or uses, never the',
    '  specific business. Do not use "our", "their", or "the shop\'s".',
    '- No people, no faces, no hands in detail.',
    '- No text, signs, menus, or labels in the frame.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The line the owner sees before this is ever switched on, and the reason it is
 * opt-in. An owner agreeing to generated imagery should understand exactly what
 * they are agreeing to — an illustration, not a photo of their shop.
 */
export const OWNER_CONSENT_COPY =
  "Want me to make photos for you? I'll create good-looking images of the kind " +
  'of thing you sell — not photos of your actual shop, and never of you or your ' +
  'staff. Instagram and TikTok will show them labelled as AI-made, and you approve ' +
  "every one before it goes out. Your own photos always win when you've sent them. " +
  'Reply YES to turn it on.';
