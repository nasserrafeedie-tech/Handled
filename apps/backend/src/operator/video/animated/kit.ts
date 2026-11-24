/**
 * The small toolkit every animated reel template draws with: time, easing,
 * colour and text helpers. Kept free of any template so the templates read as
 * a list of beats ("the price lands at 3.4s") rather than as maths.
 */
import { textWidth } from '../../graphics/text-metrics';

export const REEL_W = 1080;
export const REEL_H = 1920;
export const FPS = 30;

/* ── time ──────────────────────────────────────────────────────────────── */

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** 0 → 1 progress of `t` through the beat that starts at `at` and lasts `dur`. */
export const prog = (t: number, at: number, dur: number): number =>
  dur <= 0 ? (t >= at ? 1 : 0) : clamp01((t - at) / dur);

export const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
export const easeInOut = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
/** Overshoots a little and settles: the "lands with a bounce" ease. */
export const backOut = (x: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
export const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;

/** Round for SVG output, so two frames that look the same ARE the same string. */
export const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();
export const r3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();

/* ── text ──────────────────────────────────────────────────────────────── */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface Face {
  family: string;
  weight: number;
  tracking: number;
  upper: boolean;
}

/** The text as it will be drawn in this face (some looks set headlines in caps). */
export const shown = (s: string, face: Face): string => (face.upper ? s.toUpperCase() : s);

/** Width of one line in px, from the real font metrics (estimated if unreadable). */
export function lineWidth(s: string, face: Face, size: number): number {
  const text = shown(s, face);
  return textWidth(text, face.family, size, face.weight, face.tracking) ?? text.length * size * 0.6;
}

/**
 * The largest size, at most `max`, at which every line fits `maxWidth`.
 * Returns null when even `min` is too big: the words are too long for the
 * template and the spec has to be rejected rather than drawn off the edge.
 */
export function fitSize(
  lines: string[],
  face: Face,
  maxWidth: number,
  max: number,
  min: number,
): number | null {
  const widest = (size: number) => Math.max(0, ...lines.map((l) => lineWidth(l, face, size)));
  // Width scales linearly with size, so one measurement gives the answer.
  const at = widest(100);
  if (at <= 0) return max;
  const size = Math.floor(Math.min(max, (maxWidth / at) * 100));
  return size >= min ? size : null;
}

/**
 * Break a phrase into at most `maxLines` lines no wider than `maxWidth` at
 * `size`. Returns null if a single word is too wide or it needs more lines.
 */
export function wrapTo(
  text: string,
  face: Face,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] | null {
  const greedy = greedyWrap(text, face, size, maxWidth, maxLines);
  if (!greedy || greedy.length < 2) return greedy;
  // Balance the lines so a reel never ends a caption on one stranded word:
  // the narrowest width that still gives the same number of lines.
  let lo = 0;
  let hi = maxWidth;
  let best = greedy;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const tryLines = greedyWrap(text, face, size, mid, greedy.length);
    if (tryLines && tryLines.length === greedy.length) {
      best = tryLines;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

function greedyWrap(
  text: string,
  face: Face,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (lineWidth(next, face, size) <= maxWidth) {
      cur = next;
      continue;
    }
    if (!cur) return null; // one word wider than the frame
    lines.push(cur);
    cur = w;
    if (lineWidth(cur, face, size) > maxWidth) return null;
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

/* ── colour ────────────────────────────────────────────────────────────── */

type RGB = { r: number; g: number; b: number };

/** CSS colour words SVG accepts but our maths can't read; the common ones. */
const NAMED: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#C0392B', green: '#2E7D32', blue: '#1E5AA8',
  navy: '#1E3A5F', teal: '#0F766E', gold: '#C79A45', orange: '#E67E22', yellow: '#F2C94C',
  purple: '#6B3FA0', pink: '#E91E63', brown: '#7A4A2A', gray: '#808080', grey: '#808080',
  silver: '#C0C0C0', maroon: '#7A2733', olive: '#6B7245', beige: '#E8DCC4', ivory: '#FFFFF0',
  cream: '#F5EFE0', tan: '#D2B48C', coral: '#E9756B', salmon: '#FA8072', plum: '#5E3A6E',
  indigo: '#3F3D99', turquoise: '#2AA198', lavender: '#B69DD4', crimson: '#B0233B',
};

export function toHex(color: string | undefined, fallback: string): string {
  const c = (color ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^[0-9a-f]{6}$/.test(c)) return `#${c}`;
  return NAMED[c] ?? fallback;
}

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: string, b: string, amt: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex({ r: lerp(x.r, y.r, amt), g: lerp(x.g, y.g, amt), b: lerp(x.b, y.b, amt) });
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(h: string): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const { r, g, b } = rgb(h);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
