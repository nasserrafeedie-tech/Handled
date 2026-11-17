import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Real text widths from the bundled fonts.
 *
 * Word-wrapping used to guess a line's width as "characters × font size × a
 * fudge factor". A guess is fine for most sentences and wrong for exactly the
 * ones that look worst: a line of wide capitals ("MMW"), a short word in a
 * huge size, a price. Those ran past the edge of the frame. Reading the
 * advance widths straight out of each TTF (cmap + hmtx) makes the width exact
 * for the font that resvg will actually draw with, so a line that is measured
 * to fit really does fit.
 *
 * Kerning is ignored; it only ever tightens a line, so the measurement errs
 * slightly wide, which is the safe direction.
 */

interface FontTable {
  unitsPerEm: number;
  /** codepoint → advance width in font units */
  advance: Map<number, number>;
  fallback: number;
  /** OS/2 sCapHeight as a fraction of the em, when the font records it. */
  capHeight?: number;
}

const FONT_DIRS = [
  join(__dirname, 'fonts'),
  join(__dirname, '..', '..', '..', 'src', 'operator', 'graphics', 'fonts'),
];

/** Family (as written in the SVG) + weight → the file resvg resolves to. */
function fileFor(family: string, weight: number): string {
  const f = family.replace(/['"]/g, '').trim().toLowerCase();
  if (f.startsWith('playfair')) {
    return weight >= 700 ? 'PlayfairDisplay-ExtraBold.ttf' : 'PlayfairDisplay-VF.ttf';
  }
  if (f.startsWith('anton')) return 'Anton-Regular.ttf';
  if (f.startsWith('marcellus')) return 'Marcellus-Regular.ttf';
  // Poppins. CSS matching rounds weights above 500 UP to the nearest face we
  // ship, so 800 draws with Black (900).
  if (weight >= 800) return 'Poppins-Black.ttf';
  if (weight >= 700) return 'Poppins-Bold.ttf';
  if (weight >= 600) return 'Poppins-SemiBold.ttf';
  if (weight >= 500) return 'Poppins-Medium.ttf';
  return 'Poppins-Regular.ttf';
}

const cache = new Map<string, FontTable | null>();

function load(file: string): FontTable | null {
  if (cache.has(file)) return cache.get(file)!;
  let table: FontTable | null = null;
  for (const dir of FONT_DIRS) {
    const p = join(dir, file);
    if (existsSync(p)) {
      try {
        table = parseTtf(readFileSync(p));
      } catch {
        table = null;
      }
      break;
    }
  }
  cache.set(file, table);
  return table;
}

/** Minimal TrueType reader: head.unitsPerEm, hhea.numberOfHMetrics, hmtx, cmap (format 4). */
export function parseTtf(buf: Buffer): FontTable {
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables[buf.toString('latin1', rec, rec + 4)] = buf.readUInt32BE(rec + 8);
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) {
    if (tables[t] === undefined) throw new Error(`ttf missing ${t}`);
  }
  const unitsPerEm = buf.readUInt16BE(tables.head + 18);
  const nHMetrics = buf.readUInt16BE(tables.hhea + 34);
  const glyphAdvance = (gid: number): number => {
    const i = Math.min(gid, nHMetrics - 1);
    return buf.readUInt16BE(tables.hmtx + i * 4);
  };

  // Find the Windows Unicode BMP subtable (3,1), format 4.
  const cmap = tables.cmap;
  const n = buf.readUInt16BE(cmap + 2);
  let sub = -1;
  for (let i = 0; i < n; i++) {
    const r = cmap + 4 + i * 8;
    const platform = buf.readUInt16BE(r);
    const encoding = buf.readUInt16BE(r + 2);
    const offset = buf.readUInt32BE(r + 4);
    if ((platform === 3 && encoding === 1) || (platform === 0 && sub < 0)) {
      if (buf.readUInt16BE(cmap + offset) === 4) sub = cmap + offset;
    }
  }
  if (sub < 0) throw new Error('ttf has no format-4 cmap');

  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  const advance = new Map<number, number>();
  // Only the ranges captions and headlines actually use: Latin, Latin-1,
  // general punctuation and currency. Everything else measures as `fallback`.
  const wanted = (c: number) => (c >= 0x20 && c <= 0x24f) || (c >= 0x2000 && c <= 0x20cf);
  for (let s = 0; s < segX2 / 2; s++) {
    const end = buf.readUInt16BE(ends + s * 2);
    const start = buf.readUInt16BE(starts + s * 2);
    const delta = buf.readInt16BE(deltas + s * 2);
    const roAddr = rangeOffsets + s * 2;
    const ro = buf.readUInt16BE(roAddr);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      if (!wanted(c)) continue;
      let gid: number;
      if (ro === 0) {
        gid = (c + delta) & 0xffff;
      } else {
        const g = buf.readUInt16BE(roAddr + ro + (c - start) * 2);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid !== 0) advance.set(c, glyphAdvance(gid));
    }
  }
  const fallback = advance.get(0x6e /* n */) ?? unitsPerEm * 0.55;
  let capHeight: number | undefined;
  if (tables['OS/2'] !== undefined && buf.readUInt16BE(tables['OS/2']) >= 2) {
    const ch = buf.readInt16BE(tables['OS/2'] + 88);
    if (ch > 0) capHeight = ch / unitsPerEm;
  }
  return { unitsPerEm, advance, fallback, capHeight };
}

/**
 * Width in px of `text` set in `family` at `size` and `weight`, with
 * `tracking` px of letter-spacing (SVG adds it after every glyph). Returns
 * null only if the font file could not be read, so callers can fall back to
 * the old estimate rather than crash a render.
 */
export function textWidth(
  text: string,
  family: string,
  size: number,
  weight = 400,
  tracking = 0,
): number | null {
  const t = load(fileFor(family, weight));
  if (!t) return null;
  let units = 0;
  let glyphs = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    units += t.advance.get(c) ?? t.fallback;
    glyphs++;
  }
  return (units / t.unitsPerEm) * size + tracking * glyphs;
}

/**
 * Cap height of a face as a fraction of its size (≈0.7 for most text faces,
 * taller for condensed display faces like Anton). Used to centre words inside
 * a shape: centring on the cap height is what makes a line look optically
 * centred in its bar, where centring on the font size leaves it sitting high.
 */
export function capHeight(family: string, weight = 400): number {
  return load(fileFor(family, weight))?.capHeight ?? 0.7;
}
