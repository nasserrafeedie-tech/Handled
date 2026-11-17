/**
 * The checks a designed post has to pass before anyone sees it.
 *
 * A design is SVG that Claude drew for one post. It is allowed to look like
 * anything, but it has to keep the promises the templates keep: the owner's
 * words are there and spelled as given, nothing new is claimed, every line
 * fits on the canvas and can be read, the brand's colours and fonts are used,
 * and the photo is on show with no words over its subject. A design that
 * breaks one of these is turned back with the reason, so the next attempt can
 * fix it; two misses and the post uses the templates instead.
 *
 * Text is measured with the real font files (text-metrics), and readability is
 * measured on pixels: the design is rendered without its words and every line
 * is checked against what is really behind it.
 */

import { CANVAS, CANVAS_H } from './slide-templates';
import { capHeight, textWidth } from './text-metrics';
import type { PhotoRead } from './photo-focus';
import { LOGO_SLOT, PHOTO_SLOT, SvgRejected, parseSvg, serializeSvg, walk, type SvgNode } from './svg-guard';

export interface DesignCopy {
  headline: string;
  body?: string;
  cta?: string;
  footer?: string;
  brandName?: string;
}

export interface DesignInput {
  copy: DesignCopy;
  /** Brand colours as hex. Neutrals are always allowed besides these. */
  palette: string[];
  photo?: { dataUri: string; read: PhotoRead | null };
  logo?: string;
}

/** Rasterize an SVG at `width` px wide; RGBA, row-major. */
export type Rasterize = (
  svg: string,
  width: number,
) => { width: number; height: number; pixels: Uint8Array; png: () => Buffer };

export interface DrawnLine {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  fill: Rgb;
  faint: boolean;
}

export type DesignVerdict =
  | { ok: true; svg: string; lines: DrawnLine[]; drawnText: string; extraWords: string[] }
  | { ok: false; reason: string };

type Rgb = [number, number, number];

export const FONT_FAMILIES = ['Poppins', 'Playfair Display', 'Anton', 'Marcellus'];
const MARGIN = 40;
const MIN_SIZE = 26;
/** Text this faint is decoration (a ghosted numeral), not something to read. */
const FAINT = 0.85;
const DECOR_SIZE = 160;
const MAX_EXTRA_WORDS = 8;
const CHECK_WIDTH = 540;

// ─── small parsers ──────────────────────────────────────────────────────────

const NAMED: Record<string, Rgb> = { white: [255, 255, 255], black: [0, 0, 0] };

/** A colour value: an RGB triple, 'none' for nothing painted, 'ref' for a
 *  gradient or pattern reference, or null when we can't read it. */
export function parseColor(v: string | undefined): Rgb | 'none' | 'ref' | null {
  if (v === undefined) return null;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return 'none';
  if (/^url\(#[\w-]+\)$/.test(s)) return 'ref';
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as Rgb;
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as Rgb;
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s);
  if (m) return [1, 2, 3].map((i) => Math.min(255, Number(m![i]))) as Rgb;
  return null;
}

function num(v: string | undefined, fallback = 0, em = 16): number {
  if (v === undefined || v.trim() === '') return fallback;
  const m = /^\s*(-?[\d.]+)\s*(px|em)?\s*$/.exec(v);
  if (!m) throw new SvgRejected(`can't read the number "${v}"`);
  return m[2] === 'em' ? Number(m[1]) * em : Number(m[1]);
}

function weightOf(v: string | undefined): number {
  if (!v || v === 'normal') return 400;
  if (v === 'bold') return 700;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new SvgRejected(`can't read font-weight "${v}"`);
  return n;
}

function familyOf(v: string | undefined): string {
  const first = (v ?? 'Poppins').split(',')[0].replace(/['"]/g, '').trim();
  const hit = FONT_FAMILIES.find((f) => f.toLowerCase() === first.toLowerCase());
  if (!hit) throw new SvgRejected(`the font "${first}" isn't one of ${FONT_FAMILIES.join(', ')}`);
  return hit;
}

/** Offset and rotation a text or image picks up from its own and its
 *  ancestors' transforms. Only moves and small tilts are allowed on anything
 *  we measure, so the measurement stays honest. */
function placement(chain: SvgNode[]): { dx: number; dy: number; tilt: number } {
  let dx = 0;
  let dy = 0;
  let tilt = 0;
  for (const n of chain) {
    const t = n.attrs.transform;
    if (!t) continue;
    for (const m of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
      const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (m[1] === 'translate') {
        dx += args[0] ?? 0;
        dy += args[1] ?? 0;
      } else if (m[1] === 'rotate') {
        tilt += args[0] ?? 0;
      } else {
        throw new SvgRejected(`words and photos can be moved or tilted, not ${m[1]}()`);
      }
    }
    if (t.replace(/\w+\([^)]*\)/g, '').trim()) throw new SvgRejected(`can't read transform "${t}"`);
  }
  if (Math.abs(tilt) > 15) throw new SvgRejected('words can tilt by 15 degrees at most');
  return { dx, dy, tilt };
}

const INHERITED = ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'fill'] as const;

function inherited(chain: SvgNode[], name: (typeof INHERITED)[number]): string | undefined {
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i].attrs[name] !== undefined) return chain[i].attrs[name];
  return undefined;
}

function opacityOf(chain: SvgNode[]): number {
  let o = 1;
  for (const n of chain) {
    if (n.attrs.opacity !== undefined) o *= Number(n.attrs.opacity);
    if (n.attrs['fill-opacity'] !== undefined) o *= Number(n.attrs['fill-opacity']);
  }
  return Number.isFinite(o) ? o : 1;
}

// ─── text layout ────────────────────────────────────────────────────────────

interface Segment {
  text: string;
  family: string;
  size: number;
  weight: number;
  tracking: number;
}

function linesOf(text: SvgNode, ancestors: SvgNode[]): DrawnLine[] {
  const chain = [...ancestors, text];
  const { dx, dy, tilt } = placement(chain);
  const style = (c: SvgNode[]) => {
    const size = num(inherited(c, 'font-size'), 16);
    return {
      family: familyOf(inherited(c, 'font-family')),
      size,
      weight: weightOf(inherited(c, 'font-weight')),
      tracking: num(inherited(c, 'letter-spacing'), 0, size),
    };
  };
  const base = style(chain);
  const startX = num(text.attrs.x);
  let y = num(text.attrs.y);
  type Line = { x: number; y: number; anchor: string; segs: Segment[]; chain: SvgNode[] };
  const lines: Line[] = [];
  let cur: Line = { x: startX, y, anchor: inherited(chain, 'text-anchor') ?? 'start', segs: [], chain };
  lines.push(cur);
  for (const c of text.children) {
    if (typeof c === 'string') {
      cur.segs.push({ text: c, ...base });
      continue;
    }
    if (c.name !== 'tspan') throw new SvgRejected(`<${c.name}> can't sit inside <text>`);
    if (c.children.some((g) => typeof g !== 'string')) throw new SvgRejected('<tspan> can only hold words');
    const tchain = [...chain, c];
    const st = style(tchain);
    const moves = c.attrs.x !== undefined || c.attrs.y !== undefined || (c.attrs.dy !== undefined && num(c.attrs.dy, 0, st.size) !== 0);
    if (moves) {
      y = c.attrs.y !== undefined ? num(c.attrs.y) : y + num(c.attrs.dy, 0, st.size);
      cur = { x: c.attrs.x !== undefined ? num(c.attrs.x) : startX, y, anchor: inherited(tchain, 'text-anchor') ?? 'start', segs: [], chain: tchain };
      lines.push(cur);
    }
    cur.segs.push({ text: (c.children as string[]).join(''), ...st });
  }

  const out: DrawnLine[] = [];
  for (const l of lines) {
    // SVG collapses runs of white space and trims each line's ends.
    const segs = l.segs.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ') })).filter((s) => s.text);
    if (segs.length) {
      segs[0].text = segs[0].text.replace(/^ /, '');
      segs[segs.length - 1].text = segs[segs.length - 1].text.replace(/ $/, '');
    }
    const words = segs.map((s) => s.text).join('');
    if (!words.trim()) continue;
    let w = 0;
    for (const s of segs) {
      const sw = textWidth(s.text, s.family, s.size, s.weight, s.tracking);
      if (sw === null) throw new SvgRejected(`couldn't measure ${s.family}`);
      w += sw;
    }
    const size = Math.max(...segs.map((s) => s.size));
    const cap = Math.max(...segs.map((s) => Math.max(capHeight(s.family, s.weight), 0.7) * s.size));
    const x = l.x + dx;
    const x0 = l.anchor === 'middle' ? x - w / 2 : l.anchor === 'end' ? x - w : x;
    const lift = Math.abs(Math.sin((tilt * Math.PI) / 180)) * w * 0.5;
    const fill = parseColor(inherited(l.chain, 'fill') ?? '#000000');
    if (fill === 'ref' || fill === 'none' || fill === null) {
      throw new SvgRejected(`the words "${words.trim()}" need a solid fill colour`);
    }
    const faint = opacityOf(l.chain) < FAINT;
    if (faint && size < DECOR_SIZE) throw new SvgRejected(`the words "${words.trim()}" are too faint to read`);
    out.push({
      text: words.trim(),
      x0,
      x1: x0 + w,
      top: l.y + dy - cap - lift,
      bottom: l.y + dy + 0.24 * size + lift,
      size,
      fill,
      faint,
    });
  }
  return out;
}

// ─── copy ───────────────────────────────────────────────────────────────────

const tokens = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}$%]+/u)
    .filter(Boolean);

function inOrder(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const t of hay) if (t === needle[i]) i++;
  return i >= needle.length;
}

function share(needle: string[], hay: Set<string>): number {
  return needle.length ? needle.filter((t) => hay.has(t)).length / needle.length : 0;
}

function checkCopy(drawn: string, copy: DesignCopy): string[] | string {
  const got = tokens(drawn);
  const gotSet = new Set(got);
  const head = tokens(copy.headline);
  if (!inOrder(head, got)) return `the headline "${copy.headline}" has to appear as written`;
  for (const [label, part] of [['body', copy.body], ['button', copy.cta]] as const) {
    const t = tokens(part);
    if (!t.length) continue;
    const s = share(t, gotSet);
    // All or nothing: a cover can leave the body off, but half a sentence reads
    // as a mistake.
    if (s > 0.3 && !inOrder(t, got)) return `the ${label} text "${part}" has to appear whole, or not at all`;
  }
  const allowed = new Set([copy.headline, copy.body, copy.cta, copy.footer, copy.brandName].flatMap(tokens));
  const extra = got.filter((t) => !allowed.has(t));
  const madeUp = extra.find((t) => /\d/.test(t));
  if (madeUp) return `"${madeUp}" isn't in the post's copy; numbers and prices can only come from it`;
  if (extra.length > MAX_EXTRA_WORDS) {
    return `it adds ${extra.length} words that aren't in the copy (${extra.slice(0, 6).join(', ')}); keep it to ${MAX_EXTRA_WORDS}`;
  }
  return extra;
}

// ─── colour ─────────────────────────────────────────────────────────────────

function hueChroma([r, g, b]: Rgb): { hue: number; chroma: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const c = max - min;
  let h = 0;
  if (c > 0) {
    if (max === R) h = ((G - B) / c) % 6;
    else if (max === G) h = (B - R) / c + 2;
    else h = (R - G) / c + 4;
  }
  return { hue: (h * 60 + 360) % 360, chroma: c };
}

/** On brand: a neutral (paper, ink, greys), a brand colour, or a lighter or
 *  darker version of one. */
export function onBrand(c: Rgb, palette: Rgb[]): boolean {
  const { hue, chroma } = hueChroma(c);
  if (chroma < 0.12) return true;
  return palette.some((p) => {
    const q = hueChroma(p);
    if (Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) < 40) return true;
    const dh = Math.min(Math.abs(hue - q.hue), 360 - Math.abs(hue - q.hue));
    return q.chroma >= 0.05 && dh <= 18;
  });
}

const luminance = ([r, g, b]: Rgb | number[]) => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// ─── the check ──────────────────────────────────────────────────────────────

/** A 1×1 PNG used to swap the photo out, to see how much of it shows. */
let swatch: string | null = null;

export function checkDesign(src: string, input: DesignInput, rasterize: Rasterize): DesignVerdict {
  try {
    return run(src, input, rasterize);
  } catch (e) {
    if (e instanceof SvgRejected) return { ok: false, reason: e.message };
    throw e;
  }
}

function run(src: string, input: DesignInput, rasterize: Rasterize): DesignVerdict {
  const root = parseSvg(src);
  // Always the post canvas, whatever size the model wrote.
  root.attrs.width = String(CANVAS);
  root.attrs.height = String(CANVAS_H);
  root.attrs.viewBox = `0 0 ${CANVAS} ${CANVAS_H}`;

  const palette = input.palette.map((p) => parseColor(p)).filter((p): p is Rgb => Array.isArray(p));
  const lines: DrawnLine[] = [];
  const photos: Array<{ x: number; y: number; w: number; h: number }> = [];
  let logos = 0;

  walk(root, (n, anc) => {
    for (const a of ['fill', 'stroke', 'stop-color'] as const) {
      if (n.attrs[a] === undefined || n.attrs[a] === 'currentColor') continue;
      const c = parseColor(n.attrs[a]);
      if (c === null) throw new SvgRejected(`can't read the colour "${n.attrs[a]}"; use hex`);
      if (Array.isArray(c) && !onBrand(c, palette)) {
        throw new SvgRejected(`the colour ${n.attrs[a]} isn't one of the brand's (${input.palette.join(', ')}) or a neutral`);
      }
    }
    if (n.name === 'text') {
      if (anc.some((a) => a.name === 'defs' || a.name === 'clipPath' || a.name === 'mask')) {
        throw new SvgRejected('words have to be drawn, not used as a clip or mask');
      }
      lines.push(...linesOf(n, anc));
    }
    if (n.name === 'image') {
      const href = n.attrs.href ?? n.attrs['xlink:href'];
      const { dx, dy, tilt } = placement([...anc, n]);
      if (href === LOGO_SLOT) {
        if (!input.logo) throw new SvgRejected("this brand has no logo, so don't draw one");
        logos++;
        return;
      }
      if (href !== PHOTO_SLOT) throw new SvgRejected('an image needs the photo or logo slot');
      if (!input.photo) throw new SvgRejected("this post has no photo, so don't draw one");
      if (tilt) throw new SvgRejected("the photo can't be tilted");
      const par = n.attrs.preserveAspectRatio ?? 'xMidYMid slice';
      if (!/slice$/.test(par)) throw new SvgRejected('the photo has to fill its frame (preserveAspectRatio "… slice")');
      n.attrs.preserveAspectRatio = par;
      photos.push({ x: num(n.attrs.x) + dx, y: num(n.attrs.y) + dy, w: num(n.attrs.width), h: num(n.attrs.height) });
    }
  });

  if (input.photo && !photos.length) throw new SvgRejected("the owner's photo has to be in the design");
  if (photos.length > 2) throw new SvgRejected('use the photo twice at most');
  if (logos > 1) throw new SvgRejected('show the logo once');

  // Copy: the owner's words, as given, and nothing new worth checking.
  const live = lines.filter((l) => !l.faint);
  const drawnText = lines.map((l) => l.text).join(' ');
  const copy = checkCopy(drawnText, input.copy);
  if (typeof copy === 'string') throw new SvgRejected(copy);

  // Fit: every line inside the margins, big enough to read, not on another.
  for (const l of live) {
    if (l.size < MIN_SIZE) throw new SvgRejected(`"${l.text}" is set at ${l.size}px; ${MIN_SIZE}px is the smallest that reads on a phone`);
    const over = [MARGIN - l.x0, l.x1 - (CANVAS - MARGIN), MARGIN - l.top, l.bottom - (CANVAS_H - MARGIN)];
    const side = ['left', 'right', 'top', 'bottom'][over.findIndex((o) => o > 0)];
    if (side) {
      throw new SvgRejected(`"${l.text}" runs ${Math.ceil(Math.max(...over))}px past the ${side} margin (keep ${MARGIN}px clear; it measures ${Math.round(l.x1 - l.x0)}px wide)`);
    }
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > Math.min(a.size, b.size) * 0.2) throw new SvgRejected(`"${a.text}" and "${b.text}" overlap`);
    }
  }

  // The photo's subject stays clear of words.
  const read = input.photo?.read;
  if (read && photos.length) {
    const p = photos.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
    const band = Math.max(80, p.h * 0.14);
    const cy = p.y + read.focusY * p.h;
    const subject = { x0: p.x + p.w * 0.15, x1: p.x + p.w * 0.85, top: cy - band, bottom: cy + band };
    const hit = live.find(
      (l) => Math.min(l.x1, subject.x1) - Math.max(l.x0, subject.x0) > 0 && Math.min(l.bottom, subject.bottom) - Math.max(l.top, subject.top) > 0,
    );
    if (hit) {
      throw new SvgRejected(`"${hit.text}" sits on the photo's subject, which is around y=${Math.round(cy)} in the photo frame; move the words off it`);
    }
  }

  // Pixels: the canvas is filled, the photo shows, and every line can be read
  // against what is really behind it.
  const scale = CHECK_WIDTH / CANVAS;
  const fill = { photo: input.photo?.dataUri, logo: input.logo };
  const isText = (n: SvgNode) => n.name === 'text';
  const bare = rasterize(serializeSvg(root, fill, isText), CHECK_WIDTH);
  const px = (x: number, y: number) => {
    const i = (Math.min(bare.height - 1, Math.max(0, Math.round(y))) * bare.width + Math.min(bare.width - 1, Math.max(0, Math.round(x)))) * 4;
    return bare.pixels.subarray(i, i + 4);
  };
  for (const [x, y] of [[1, 1], [bare.width - 2, 1], [1, bare.height - 2], [bare.width - 2, bare.height - 2], [bare.width / 2, bare.height / 2]]) {
    if (px(x, y)[3] < 250) throw new SvgRejected('the design has to fill the whole canvas, with no see-through areas');
  }

  if (photos.length && input.photo) {
    swatch ??= `data:image/png;base64,${rasterize(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff00ff"/></svg>',
      8,
    ).png().toString('base64')}`;
    const swapped = rasterize(serializeSvg(root, { ...fill, photo: swatch }, isText), CHECK_WIDTH);
    let changed = 0;
    for (let i = 0; i < bare.pixels.length; i += 16) {
      const d = Math.abs(bare.pixels[i] - swapped.pixels[i]) + Math.abs(bare.pixels[i + 1] - swapped.pixels[i + 1]) + Math.abs(bare.pixels[i + 2] - swapped.pixels[i + 2]);
      if (d > 30) changed++;
    }
    const shown = changed / (bare.pixels.length / 16);
    if (shown < 0.2) throw new SvgRejected(`the photo only shows on ${Math.round(shown * 100)}% of the post; give it at least a fifth`);
  }

  for (const l of live) {
    const need = l.size >= 40 ? 3 : 4.5;
    const lt = luminance(l.fill);
    let n = 0;
    let good = 0;
    for (let y = l.top * scale; y <= l.bottom * scale; y += 2) {
      for (let x = l.x0 * scale; x <= l.x1 * scale; x += 2) {
        const p = px(x, y);
        n++;
        if (ratio(lt, luminance([p[0], p[1], p[2]])) >= need) good++;
      }
    }
    if (n && good / n < 0.85) {
      throw new SvgRejected(`"${l.text}" is hard to read on what's behind it (${Math.round((good / n) * 100)}% of it has enough contrast); darken, lighten or back it`);
    }
  }

  // Nothing drawn on top of the words: render with them and without, and
  // every glyph-wide slice of each line has to show a change.
  const finalSvg = serializeSvg(root, fill);
  const full = rasterize(finalSvg, CHECK_WIDTH);
  for (const l of live) {
    const step = Math.max(4, l.size * 0.6 * scale);
    const y0 = Math.max(0, Math.floor(l.top * scale));
    const y1 = Math.min(full.height - 1, Math.ceil(l.bottom * scale));
    let cols = 0;
    let shown = 0;
    const right = l.x1 * scale;
    for (let cx = l.x0 * scale; cx < right - step / 2; cx += step) {
      // A last slice shorter than half a glyph joins the one before it.
      const end = right - (cx + step) < step / 2 ? right : cx + step;
      let n = 0;
      let d = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = Math.max(0, Math.floor(cx)); x < Math.min(full.width, end); x++) {
          const i = (y * full.width + x) * 4;
          n++;
          if (Math.abs(full.pixels[i] - bare.pixels[i]) + Math.abs(full.pixels[i + 1] - bare.pixels[i + 1]) + Math.abs(full.pixels[i + 2] - bare.pixels[i + 2]) > 60) d++;
        }
      }
      cols++;
      if (n && d / n > 0.03) shown++;
    }
    if (cols && shown / cols < 0.85) throw new SvgRejected(`part of "${l.text}" is hidden under something drawn on top of it`);
  }

  return { ok: true, svg: finalSvg, lines, drawnText, extraWords: copy };
}
