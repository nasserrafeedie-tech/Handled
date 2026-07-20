import {
  Archetype,
  ArchetypeFields,
  DOC_FIELDS,
  PROSE_FIELDS,
  slugify,
} from './playbook.types';

/**
 * The Markdown ↔ archetype bridge, both directions.
 *
 * PARSE: `social-playbook.md` → archetype rows (the one-time seed import, and
 * re-importing Nasser's hand edits).
 * RENDER: rows → the same Markdown, so the human doc is always a mirror of the
 * database after research adds or refreshes an archetype.
 *
 * The doc's field labels and their order are a contract (see DOC_FIELDS) — the
 * playbook itself says "Don't rename fields."
 */

/**
 * Split on a delimiter only where it's structural — not inside parentheses,
 * brackets, or quotes. "keyword captions ("best latte in [city]"), #tag"
 * is two items, and the comma inside the quoted phrase must not split it.
 */
function splitTopLevel(value: string, delimiters: string[]): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (quote) {
      // Straight and curly quotes both appear in the doc.
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === '“') {
      quote = ch === '“' ? '”' : '"';
      buf += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);

    if (depth === 0 && delimiters.includes(ch)) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);

  return out
    .map((s) => s.trim().replace(/\.$/, '').trim())
    .filter(Boolean);
}

/**
 * The playbook uses a different separator per field — commas for pillars and
 * discovery, semicolons for reels and formats, "·" for caption hooks (whose
 * items contain their own commas). Detect which one is structural here rather
 * than assuming, or a comma-delimited field collapses into one long blob.
 */
function splitItems(value: string): string[] {
  if (value.includes('·')) return splitTopLevel(value, ['·']);
  if (value.includes(';')) return splitTopLevel(value, [';']);
  return splitTopLevel(value, [',']);
}

/** "- **Maps from:** coffee shop, espresso bar." → ["coffee shop", "espresso bar"] */
function splitCommaList(value: string): string[] {
  return splitTopLevel(value, [',']);
}

export interface ParsedArchetype extends Archetype {
  /** The "Researched:" line, e.g. "2026-07-20 (seed)". */
  researchedRaw: string;
  researchedAt: Date;
  status: 'seed' | 'researched' | 'needs_review';
}

/**
 * Parse every `### ARCHETYPE:` section out of the playbook doc.
 * Throws on a section missing required fields — a silent partial import would
 * mean a customer gets planned with half a strategy.
 */
export function parsePlaybookDoc(markdown: string): ParsedArchetype[] {
  const sections = markdown.split(/^### ARCHETYPE:\s*/m).slice(1);
  return sections.map((section) => {
    const lines = section.split('\n');
    const title = (lines[0] ?? '').trim();
    if (!title) throw new Error('ARCHETYPE section with no title');

    // Collect "- **Label:** value" lines, tolerating bold inside the value.
    const raw = new Map<string, string>();
    for (const line of lines.slice(1)) {
      if (line.startsWith('### ') || line.startsWith('## ')) break;
      const m = /^-\s+\*\*([^:*]+):\*\*\s*(.+)$/.exec(line.trim());
      if (m) raw.set(m[1].trim(), m[2].trim());
    }

    const fields: Record<string, unknown> = {};
    for (const { label, key } of DOC_FIELDS) {
      const value = raw.get(label);
      if (!value) {
        throw new Error(`Archetype "${title}" is missing field "${label}"`);
      }
      if ((PROSE_FIELDS as readonly string[]).includes(key)) {
        fields[key] = value.replace(/\.$/, '');
      } else if (key === 'mapsFrom') {
        fields[key] = splitCommaList(value);
      } else {
        // Most fields are "a; b; c" or "a · b · c"; a single sentence is a
        // one-item list, which keeps prose-y fields (cadence) intact.
        fields[key] = splitItems(value);
      }
    }

    const parsedFields = ArchetypeFields.parse(fields);
    const researchedRaw = raw.get('Researched') ?? '';
    const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(researchedRaw);

    return {
      ...parsedFields,
      slug: slugify(title),
      title,
      researchedRaw,
      researchedAt: dateMatch ? new Date(dateMatch[1]) : new Date(),
      status: /seed/i.test(researchedRaw) ? 'seed' : 'researched',
    };
  });
}

/** One archetype rendered back into the doc's exact shape. */
export function renderArchetypeSection(a: {
  title: string;
  mapsFrom: string[];
  platforms: unknown;
  pillars: unknown;
  topFormats: unknown;
  cadence: unknown;
  reels: unknown;
  photoStyle: string;
  captionHooks: unknown;
  discovery: unknown;
  offers: unknown;
  seasonal: unknown;
  mistakes: unknown;
  revenueMetric: string;
  researchedAt: Date;
  status: string;
  confidence?: number;
}): string {
  const asList = (v: unknown): string =>
    Array.isArray(v) ? v.join('; ') : String(v ?? '');

  const lines = [`### ARCHETYPE: ${a.title}`];
  for (const { label, key } of DOC_FIELDS) {
    const value = (a as unknown as Record<string, unknown>)[key];
    const rendered =
      key === 'mapsFrom'
        ? (value as string[]).join(', ')
        : (PROSE_FIELDS as readonly string[]).includes(key)
          ? String(value ?? '')
          : asList(value);
    lines.push(`- **${label}:** ${rendered}.`);
  }
  const date = a.researchedAt.toISOString().slice(0, 10);
  const tag =
    a.status === 'seed'
      ? '(seed)'
      : `(${a.status}${a.confidence !== undefined ? `, confidence ${a.confidence.toFixed(2)}` : ''})`;
  lines.push(`- **Researched:** ${date} ${tag}.`);
  return lines.join('\n');
}

/**
 * Rebuild the whole doc: everything above "## Part 2 — Archetypes" is
 * cross-cutting prose we preserve verbatim; the archetype sections below are
 * regenerated from the database.
 */
export function renderPlaybookDoc(
  originalMarkdown: string,
  archetypes: Parameters<typeof renderArchetypeSection>[0][],
): string {
  const marker = '## Part 2 — Archetypes';
  const markerIdx = originalMarkdown.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error('Playbook doc is missing its "## Part 2 — Archetypes" heading');
  }
  // Keep the fixed-field-order note that follows the heading, plus anything
  // after the archetypes (the Sources section).
  const head = originalMarkdown.slice(0, markerIdx + marker.length);
  const afterMarker = originalMarkdown.slice(markerIdx + marker.length);
  const preamble = afterMarker.slice(0, afterMarker.indexOf('### ARCHETYPE:'));
  const tailIdx = afterMarker.indexOf('\n---\n');
  const tail = tailIdx === -1 ? '' : afterMarker.slice(tailIdx);

  const body = archetypes
    .map((a) => renderArchetypeSection(a))
    .join('\n\n');

  return `${head}${preamble}${body}\n${tail}`;
}
