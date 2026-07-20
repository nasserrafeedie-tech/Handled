import { z } from 'zod';

/**
 * The archetype schema — the exact shape of one section in
 * `~/handled-hq/operations/social-playbook.md`, and of one `PlaybookArchetype`
 * row. Research (Flow 2) must fill every one of these fields, which is why the
 * schema lives here rather than being implied by the parser.
 *
 * Field ORDER matters: the doc renderer writes them back in this order, so a
 * regenerated playbook keeps the human-readable structure Nasser edits.
 */

/** Fields that are prose lines in the doc and single strings in the DB. */
export const PROSE_FIELDS = ['photoStyle', 'revenueMetric'] as const;

/**
 * Models drift between `["Instagram (primary)"]` and
 * `[{platform: "Instagram", why: "primary"}]` for the same field, and a hard
 * schema failure here would abandon a whole research pass. Accept either and
 * flatten objects to the readable string the doc and prompts expect.
 */
function flattenToLine(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenToLine).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Prefer the obvious "headline" key, then append the rest as context.
    const headKey = ['name', 'title', 'text', 'idea', 'hook', 'platform', 'format', 'item'].find(
      (k) => typeof obj[k] === 'string',
    );
    const head = headKey ? String(obj[headKey]).trim() : '';
    const rest = Object.entries(obj)
      .filter(([k, v]) => k !== headKey && v != null && typeof v !== 'object')
      .map(([, v]) => String(v).trim())
      .filter(Boolean);
    if (head && rest.length) return `${head} (${rest.join(', ')})`;
    if (head) return head;
    return rest.join(' — ');
  }
  return '';
}

/** An array of short lines, tolerant of the model returning objects. */
const lineList = (max: number, maxLen = 300) =>
  z
    .array(z.unknown())
    .min(1)
    .max(max)
    .transform((arr) =>
      arr
        .map(flattenToLine)
        .map((s) => s.slice(0, maxLen))
        .filter((s) => s.length > 0),
    )
    .refine((arr) => arr.length > 0, 'no usable items');

/** A single prose line, tolerant of the model returning an object. */
const proseLine = (maxLen = 400) =>
  z
    .unknown()
    .transform((v) => flattenToLine(v).slice(0, maxLen))
    .refine((s) => s.length > 0, 'empty');

export const ArchetypeFields = z.object({
  /** Synonyms the classifier matches a business description against. */
  mapsFrom: lineList(24, 120),
  /** Ranked platforms + why, as written ("Instagram (primary), TikTok, GBP"). */
  platforms: lineList(10),
  /** Content pillars — the recurring subject matter. */
  pillars: lineList(12),
  /** Which formats earn reach/engagement here. */
  topFormats: lineList(10),
  /** Posting rhythm in the doc's own words ("4–5 feed/wk + daily Stories"). */
  cadence: lineList(6),
  /** Reel concepts proven in this trade. */
  reels: lineList(10),
  /** How photos should look and feel — one prose line. */
  photoStyle: proseLine(),
  /** Caption opening patterns that earn saves/shares. */
  captionHooks: lineList(10),
  /** Local discovery tactics (keywords, GBP, geotags). */
  discovery: lineList(12),
  /** Offer structures that actually convert for this trade. */
  offers: lineList(12),
  /** Seasonal beats worth planning around. */
  seasonal: lineList(12),
  /** The failure modes to steer away from. */
  mistakes: lineList(12),
  /** The metric that maps closest to revenue — one prose line. */
  revenueMetric: proseLine(),
});
export type ArchetypeFields = z.infer<typeof ArchetypeFields>;

/** A full archetype: identity + the strategy fields. */
export const Archetype = ArchetypeFields.extend({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'kebab-case slug'),
  title: z.string().min(1),
});
export type Archetype = z.infer<typeof Archetype>;

/**
 * The doc's field labels, in the fixed order the playbook uses. The importer
 * parses by these; the renderer writes by these. `social-playbook.md` says
 * "Don't rename fields" — this constant is why.
 */
export const DOC_FIELDS: ReadonlyArray<{
  label: string;
  key: keyof ArchetypeFields;
}> = [
  { label: 'Maps from', key: 'mapsFrom' },
  { label: 'Platforms', key: 'platforms' },
  { label: 'Content pillars', key: 'pillars' },
  { label: 'Top formats', key: 'topFormats' },
  { label: 'Cadence', key: 'cadence' },
  { label: 'Reels that work', key: 'reels' },
  { label: 'Photo style', key: 'photoStyle' },
  { label: 'Caption hooks', key: 'captionHooks' },
  { label: 'Local discovery', key: 'discovery' },
  { label: 'Offers that convert', key: 'offers' },
  { label: 'Seasonal hooks', key: 'seasonal' },
  { label: 'Mistakes', key: 'mistakes' },
  { label: 'Revenue metric', key: 'revenueMetric' },
];

/** "Cafés & coffee shops" → "cafes-coffee-shops" */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: Cafés → Cafes
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Normalize a free-text business type for dedupe ("Axe Throwing Venue!" and
 * "axe-throwing venue" are the same research job).
 */
export function normalizeBusinessType(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
