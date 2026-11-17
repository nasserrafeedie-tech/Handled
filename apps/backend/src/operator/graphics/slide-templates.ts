/**
 * Slide templates → SVG. We compose the design ourselves so the text is always
 * crisp and correctly spelled (unlike diffusion image models), but the result
 * still looks professionally designed.
 *
 * Variety comes from three independent axes that multiply together, so a feed
 * never reads as one card recoloured:
 *   • SURFACE — the background treatment: dark gradient, cream paper, pastel
 *     tint, solid brand block, accent panel, framed page, or a colour split.
 *     Each carries its own palette so the type reads on light or dark.
 *   • COMPOSITION — the decorative arrangement layered on top: rings, dot grids,
 *     arcs, stripes, plus-mark confetti, a soft blob, or clean negative space.
 *   • TYPE STYLE — the font pairing (modern / editorial / bold / luxe).
 *
 * Cohesion within a post, variety between posts: every slide in one carousel
 * shares a `seed` and therefore one surface and palette — it's a single post, so
 * it has to look like a set — while each slide's `variant` shifts only the
 * decoration. Two different posts get different seeds, and that is where a
 * feed's variety comes from.
 *
 * Output is an SVG string that GraphicsService rasterizes to PNG on an
 * Instagram 4:5 portrait canvas.
 */

import { capHeight, textWidth } from './text-metrics';

export const CANVAS = 1080;
// 4:5 portrait (1080×1350) — the maximum feed real estate. Every 2025-26
// benchmark and design guide converged on portrait over square for carousels.
export const CANVAS_H = 1350;

/**
 * A stable non-negative integer derived from a string (a customer id). Used as a
 * per-brand offset into the design rotation so two different businesses do not
 * land on the identical surface + shapes at the same post number — the "you can
 * tell it was made by Handled" fingerprint. Deterministic, so a re-render of the
 * same post is always identical. (djb2 — small, well-spread, no crypto needed.)
 */
export function stableSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export type SlideKind = 'title' | 'body' | 'quote' | 'promo' | 'cta';

/**
 * How a photo is used behind the type. Picking one per post is what keeps a
 * feed from looking like the same template four times a week.
 *   full  — photo fills the frame, text sits on a dark scrim
 *   card  — photo fills the frame, text sits in a floating card
 *   band  — photo on top, solid brand color below
 *   frame — photo inset with a margin, like a print on a mat, words below
 */
export type PhotoLayout = 'full' | 'card' | 'band' | 'frame';

/**
 * Which photo layout slide `index` of a post seeded `seed` uses. Covers walk
 * full → card → frame and inside slides walk band → frame, so two photo posts
 * in a row never share a cover treatment (seeds of neighbouring posts differ
 * by one). A whole post shares one seed, so its slides still look like a set.
 */
export function photoLayoutFor(seed: number, index: number): PhotoLayout {
  const s = Math.abs(Math.floor(seed));
  if (index === 0) return (['full', 'card', 'frame'] as const)[s % 3];
  return (['band', 'frame'] as const)[s % 2];
}

/**
 * How the words themselves are arranged on a designed (text) slide. Before
 * this, every title and body slide was the same stack — small brand line,
 * headline, short rule, paragraph — on a rotating background, and a feed of
 * them read as one template recoloured. The layout now changes per post:
 *   stack     — the classic: brand line, headline, rule, paragraph
 *   poster    — a huge headline anchored to the bottom, like a gig poster
 *   highlight — each headline line on a marker-style colour bar
 *   split     — a solid colour block holds the headline, the paragraph sits below
 *   numeral   — a giant number leads ("3 ways…", "$18", step 01/02 on inside slides)
 */
export type TextLayout = 'stack' | 'poster' | 'highlight' | 'split' | 'numeral';

/** Rotation order. Neighbours are deliberately unlike each other. */
const TEXT_LAYOUTS: TextLayout[] = ['poster', 'highlight', 'stack', 'split', 'numeral'];

/**
 * The number a numeral layout can lead with: a price, a percentage, or a small
 * count ("3 ways", "$18", "2 minutes"). Long numbers (years, phone numbers)
 * don't count — a giant "2026" isn't a design, it's a date.
 */
export function leadNumber(
  headline: string,
): { before: string; num: string; after: string } | null {
  const m = /(^|\s)(\$?\d{1,3}(?:[.,]\d{1,2})?%?)(?=[\s,.!?:]|$)/.exec(headline);
  if (!m) return null;
  const num = m[2];
  if (num.replace(/\D/g, '').length > 4) return null;
  const at = m.index + m[1].length;
  return {
    before: headline.slice(0, at).trim(),
    num,
    after: headline.slice(at + num.length).replace(/^[\s,.:]+/, '').trim(),
  };
}

/**
 * The text layout for a post. Seeded by the POST (every slide in a carousel
 * shares it, so the set stays coherent); consecutive posts differ because
 * their seeds differ by one and no layout sits next to itself in the rotation.
 * A numeral turn with no number to show falls back to highlight or stack
 * (alternating), neither of which neighbours numeral in the rotation, so the
 * no-repeat promise still holds.
 */
export function textLayoutFor(seed: number, coverHeadline?: string): TextLayout {
  const l = TEXT_LAYOUTS[Math.abs(Math.floor(seed)) % TEXT_LAYOUTS.length];
  if (l === 'numeral' && coverHeadline !== undefined && !leadNumber(coverHeadline)) {
    // Alternate the stand-in so it doesn't make one layout twice as common.
    return Math.floor(Math.abs(seed) / TEXT_LAYOUTS.length) % 2 === 0 ? 'highlight' : 'stack';
  }
  return l;
}

export type BrandStyle = 'modern' | 'editorial' | 'bold' | 'luxe';

export interface BrandTheme {
  /** Primary brand color, e.g. "#0F172A". Drives the background gradient. */
  primary: string;
  /** Secondary accent (badges, dividers). Derived from primary if omitted. */
  secondary?: string;
  /** Main text color. Defaults to auto contrast against the background. */
  text?: string;
  /** Business name shown in the footer. */
  brandName?: string;
  /** Type personality. Defaults to 'modern'. */
  style?: BrandStyle;
  /**
   * The business's real logo, as a `data:image/...;base64,...` URI. When set, a
   * word slide shows the logo badge in place of the text brand-name footer — the
   * real mark, composited, never generated. The handler base64-encodes the file
   * fetched from storage; the renderer stays pure.
   */
  logoDataUri?: string;
}

export interface SlideSpec {
  kind: SlideKind;
  headline: string;
  body?: string;
  footer?: string;
  /**
   * A photo to sit behind the design, as a data URI (data:image/jpeg;base64,…).
   * GraphicsService.fetchPhoto() turns a URL into one. Omit for a solid
   * gradient background.
   */
  photo?: string;
  /** How the photo is composed with the type. Defaults to 'full'. */
  photoLayout?: PhotoLayout;
  /**
   * How the words are arranged on a designed slide. Normally left unset: it is
   * derived from `seed` (see textLayoutFor) so a carousel shares one layout
   * and the next post gets another. Set it to force one (tests, previews).
   */
  textLayout?: TextLayout;
  /**
   * The carousel's cover headline. Lets every slide in a set agree on the
   * layout when the cover has no number for a numeral layout to show.
   */
  coverHeadline?: string;
  /**
   * Which look this SET of slides uses — the surface (background treatment and
   * the palette that reads on it). Every slide in one carousel must be given the
   * same seed: a carousel is a single post, so its slides have to look like a
   * set. Variety belongs *between* posts, which is why the caller seeds this off
   * the post rather than the slide. Stable per post, so a re-render is identical.
   */
  seed?: number;
  /**
   * Which slide this is within the set. Varies the decorative arrangement only —
   * same surface, same palette, different shapes behind the words — so a
   * carousel has rhythm without looking like five unrelated cards.
   */
  variant?: number;
  /**
   * The words on the CTA slide's button. Must be the business's REAL action
   * ("Text us", "Book now", "Come by") — a generic "Visit us" under a
   * headline that says "text us the line" reads as nonsense. Only used when
   * kind === 'cta'.
   */
  ctaLabel?: string;
  /**
   * How many slides are in this set. When ≥2 (and `variant` is set) the slide
   * carries a small "n / N" progress tag — numbered progress sets completion
   * expectations and measurably lifts swipe-through. Omit for one-off graphics.
   */
  total?: number;
}

/* ── fonts ─────────────────────────────────────────────────────────────── */
const SANS = 'Poppins';
const SERIF = "'Playfair Display'";
const DISPLAY = 'Anton';
const LUXE = 'Marcellus';

interface TypeSet {
  /** Face for big headlines. */
  head: string;
  headWeight: number;
  /** Letter-spacing for headlines (Anton/Marcellus like a little air). */
  headTracking: number;
  /** Face for supporting copy, badges and footers. */
  body: string;
  /** Face for pull-quotes. */
  quote: string;
  quoteItalic: boolean;
  /** Headlines set in all caps? (poster styles look better shouting.) */
  headUpper: boolean;
}

function typeSet(style: BrandStyle | undefined): TypeSet {
  switch (style) {
    case 'editorial':
      // 800 resolves to the STATIC PlayfairDisplay-ExtraBold.ttf in fonts/.
      // The variable font's weight axis is ignored by resvg — every weight
      // rendered as Regular, which is why editorial headlines shipped thin.
      // The static instance was cut from the VF (fontTools varLib.instancer).
      return {
        head: SERIF, headWeight: 800, headTracking: 0,
        body: SANS, quote: SERIF, quoteItalic: true, headUpper: false,
      };
    case 'bold':
      return {
        head: DISPLAY, headWeight: 400, headTracking: 1,
        body: SANS, quote: SANS, quoteItalic: false, headUpper: true,
      };
    case 'luxe':
      return {
        head: LUXE, headWeight: 400, headTracking: 3,
        body: SANS, quote: LUXE, quoteItalic: false, headUpper: false,
      };
    case 'modern':
    default:
      return {
        head: SANS, headWeight: 800, headTracking: 0,
        body: SANS, quote: SERIF, quoteItalic: true, headUpper: false,
      };
  }
}

/* ── color utilities ───────────────────────────────────────────────────── */
type RGB = { r: number; g: number; b: number };

function parseHex(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 15, g: 23, b: 42 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function toHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(hex: string, target: RGB, amt: number): string {
  const a = parseHex(hex);
  return toHex({
    r: a.r + (target.r - a.r) * amt,
    g: a.g + (target.g - a.g) * amt,
    b: a.b + (target.b - a.b) * amt,
  });
}
const BLACK: RGB = { r: 0, g: 0, b: 0 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const darken = (hex: string, amt: number) => mix(hex, BLACK, amt);
const lighten = (hex: string, amt: number) => mix(hex, WHITE, amt);
function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function contrastText(hex: string): string {
  return luminance(hex) > 0.6 ? '#1A1712' : '#FFFFFF';
}

/* ── text utilities ────────────────────────────────────────────────────── */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The face a block of text is set in — what `wrap` measures against. */
interface Face {
  family: string;
  weight: number;
  tracking?: number;
}

/**
 * Widest line any `wrap` call produced since the last reset. The auto-fit loop
 * reads it: a single word too wide for the frame (a long name in a huge size)
 * can't be fixed by wrapping, only by shrinking the type, and height alone
 * never notices it.
 */
let widestLine = 0;

/**
 * Word-wrap to a pixel width. With a `face`, lines are measured from the real
 * font metrics (text-metrics.ts); without one — or if the font can't be read —
 * the old estimate of `factor` × font size per character is used.
 */
function wrap(
  text: string,
  fontSize: number,
  maxWidth: number,
  factor = 0.56,
  face?: Face,
  balance = false,
  probe = false,
): string[] {
  const width = (s: string): number =>
    (face && textWidth(s, face.family, fontSize, face.weight, face.tracking ?? 0)) ??
    s.length * fontSize * factor;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && width(next) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (balance && lines.length > 1) {
    // Even the lines out: find the narrowest width that still needs no more
    // lines than the greedy pass did. "NEW CHAIR, SAME / CREW" becomes
    // "NEW CHAIR, / SAME CREW" — no lonely last word under a long line.
    let lo = 0;
    let hi = maxWidth;
    let best = lines;
    for (let i = 0; i < 14 && hi - lo > 2; i++) {
      const mid = (lo + hi) / 2;
      const trial = wrap(text, fontSize, mid, factor, face, false, true);
      if (trial.length <= lines.length && trial.every((l) => width(l) <= mid + 0.5)) {
        best = trial;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    lines.splice(0, lines.length, ...best);
  }
  if (!probe) for (const l of lines) widestLine = Math.max(widestLine, width(l));
  return lines;
}

/**
 * Hard ceiling on how many lines a block may occupy. Auto-fit shrinks type to
 * make copy fit, but a genuinely long paragraph has to be cut somewhere —
 * better a trimmed sentence than text running off the edge of the image.
 */
function clampLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = kept[max - 1].replace(/[\s,.;:]+$/, '') + '…';
  return kept;
}

function tspansCentered(lines: string[], cx: number, startY: number, lineHeight: number): string {
  return lines
    .map((l, i) => `<tspan x="${cx}" y="${startY + i * lineHeight}">${esc(l)}</tspan>`)
    .join('');
}
function tspansLeft(lines: string[], x: number, startY: number, lineHeight: number): string {
  return lines
    .map((l, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${esc(l)}</tspan>`)
    .join('');
}

/* ── palette ───────────────────────────────────────────────────────────── */
/**
 * The colours a text layout draws with. A surface (below) produces one of these
 * to match its background — so the same layout code reads correctly whether it's
 * sitting on a dark gradient, cream paper, or a solid accent block.
 */
interface Palette {
  bgTop: string;
  bgBottom: string;
  fg: string;
  fgSoft: string; // muted foreground for body copy
  accent: string; // the pop colour for eyebrows, rules, dots, pills — contrasts the surface
  onAccent: string; // text/icon colour on top of an accent fill
  deco: string; // decorative-shape colour, drawn at low opacity
}

/** The two brand colours every surface is built from. */
interface Base {
  primary: string;
  accent: string;
}

function basePalette(theme: BrandTheme): Base {
  const primary = /^#?[0-9a-f]{6}$/i.test(theme.primary || '') ? theme.primary : '#0F172A';
  const accent =
    theme.secondary && /^#?[0-9a-f]{6}$/i.test(theme.secondary)
      ? theme.secondary
      : luminance(primary) > 0.55
        ? darken(primary, 0.4)
        : lighten(primary, 0.42);
  return { primary, accent };
}

/** A brand colour dark enough to read on a LIGHT surface. */
function popOnLight(b: Base): string {
  if (luminance(b.primary) < 0.62) return b.primary;
  if (luminance(b.accent) < 0.62) return b.accent;
  return darken(b.primary, 0.45);
}
/** A brand colour bright enough to read on a DARK surface. */
function vividOnDark(b: Base): string {
  if (luminance(b.accent) > 0.42) return b.accent;
  if (luminance(b.primary) > 0.42) return b.primary;
  return lighten(b.accent, 0.42);
}

/**
 * The photo palette — the original dark-gradient treatment, kept for slides that
 * sit a real photo behind the type. Photos want a consistent dark scrim, so they
 * don't ride the surface rotation the way text-only slides do.
 */
function photoPalette(theme: BrandTheme): Palette {
  const primary = /^#?[0-9a-f]{6}$/i.test(theme.primary || '') ? theme.primary : '#0F172A';
  const dark = luminance(primary) > 0.55;
  const bgTop = dark ? lighten(primary, 0.08) : lighten(primary, 0.06);
  const bgBottom = dark ? darken(primary, 0.18) : darken(primary, 0.34);
  const fg = theme.text || contrastText(bgBottom);
  const b = basePalette(theme);
  const accent = vividOnDark(b);
  return {
    bgTop, bgBottom, fg,
    fgSoft: fg === '#FFFFFF' ? 'rgba(255,255,255,0.82)' : 'rgba(26,23,18,0.72)',
    accent, onAccent: contrastText(accent),
    deco: fg === '#FFFFFF' ? '#FFFFFF' : '#1A1712',
  };
}

/* ── surfaces ──────────────────────────────────────────────────────────── */
/**
 * A surface is a complete background treatment plus the palette that reads on
 * it. Decoupling the surface from the type layout is what turns "one card,
 * recoloured" into a deep catalogue of looks: the same headline can land on a
 * dark gradient, cream paper, a pastel tint, a solid brand block, an accent
 * panel, a colour split, or a framed page — and each still looks designed.
 */
interface Surface {
  p: Palette;
  bg: string; // <defs> + background rect + any signature shape
  allowDeco: boolean; // may a decorative composition be overlaid on top?
}

/** <defs> holding the #bg fill and a #glow radial the compositions can use. */
function surfaceDefs(bgFill: string, glowColor: string, glowOpacity: number): string {
  return `<defs>${bgFill}
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${glowColor}" stop-opacity="${glowOpacity}"/>
      <stop offset="1" stop-color="${glowColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

/** A plain (flat or linear-gradient) surface — the workhorse for most looks. */
function flatSurface(bgColor: string, b: Base, grad?: [string, string]): Surface {
  const isLight = luminance(bgColor) > 0.6;
  const fg = contrastText(bgColor);
  let pop = isLight ? popOnLight(b) : vividOnDark(b);
  // If the pop colour is too close in value to the background, it won't read —
  // fall back to the foreground so eyebrows and rules never vanish.
  if (Math.abs(luminance(pop) - luminance(bgColor)) < 0.22) pop = fg;
  const fill = grad
    ? `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient>`
    : `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgColor}"/><stop offset="1" stop-color="${bgColor}"/></linearGradient>`;
  const p: Palette = {
    bgTop: grad?.[0] ?? bgColor,
    bgBottom: grad?.[1] ?? bgColor,
    fg,
    fgSoft: isLight ? 'rgba(31,27,22,0.64)' : 'rgba(255,255,255,0.80)',
    accent: pop,
    onAccent: contrastText(pop),
    deco: isLight ? pop : '#FFFFFF',
  };
  const bg = `${surfaceDefs(fill, pop, isLight ? 0.09 : 0.28)}<rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#bg)"/>`;
  return { p, bg, allowDeco: true };
}

/** A surface flooded in the accent colour — bold, used sparingly in the rotation. */
function accentSurface(b: Base): Surface {
  const bg = luminance(b.accent) > 0.72 ? darken(b.accent, 0.14) : b.accent;
  const fg = contrastText(bg);
  const fill = `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(bg, 0.06)}"/><stop offset="1" stop-color="${darken(bg, 0.16)}"/></linearGradient>`;
  const p: Palette = {
    bgTop: lighten(bg, 0.06), bgBottom: darken(bg, 0.16),
    fg,
    fgSoft: fg === '#FFFFFF' ? 'rgba(255,255,255,0.82)' : 'rgba(31,27,22,0.66)',
    accent: fg, // on an accent field, the pop colour is the contrast colour
    onAccent: bg,
    deco: fg,
  };
  return { p, bg: `${surfaceDefs(fill, fg, 0.10)}<rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#bg)"/>`, allowDeco: true };
}

/** Cream paper with a bold accent triangle in one corner — editorial, distinctive. */
function splitSurface(b: Base): Surface {
  const paper = lighten(b.primary, 0.9);
  const pop = popOnLight(b);
  const block = luminance(b.primary) < 0.6 ? b.primary : darken(b.accent, 0.1);
  const p: Palette = {
    bgTop: paper, bgBottom: paper,
    fg: '#211C16', fgSoft: 'rgba(33,28,22,0.64)',
    accent: pop, onAccent: contrastText(pop), deco: pop,
  };
  // Two corner triangles, clear of the centre column where the type sits.
  const bg = `${surfaceDefs(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(paper, 0.3)}"/><stop offset="1" stop-color="${paper}"/></linearGradient>`, pop, 0.08)}
    <rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#bg)"/>
    <path d="M ${CANVAS} 0 L ${CANVAS} 420 L ${CANVAS - 420} 0 Z" fill="${block}"/>
    <path d="M 0 ${CANVAS_H} L 0 ${CANVAS_H - 300} L 300 ${CANVAS_H} Z" fill="${pop}" opacity="0.14"/>`;
  return { p, bg, allowDeco: false };
}

/** Cream paper inside a thin drawn frame — quiet, magazine-like. */
function borderedPaper(b: Base): Surface {
  const paper = lighten(b.primary, 0.92);
  const pop = popOnLight(b);
  const p: Palette = {
    bgTop: paper, bgBottom: paper,
    fg: '#211C16', fgSoft: 'rgba(33,28,22,0.64)',
    accent: pop, onAccent: contrastText(pop), deco: pop,
  };
  const m = 46;
  const bg = `${surfaceDefs(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(paper, 0.4)}"/><stop offset="1" stop-color="${paper}"/></linearGradient>`, pop, 0.07)}
    <rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#bg)"/>
    <rect x="${m}" y="${m}" width="${CANVAS - m * 2}" height="${CANVAS_H - m * 2}" rx="26" fill="none" stroke="${pop}" stroke-opacity="0.35" stroke-width="3"/>`;
  return { p, bg, allowDeco: false };
}

/**
 * The surface rotation. Ordered so walking it slide-to-slide gives a rhythm of
 * value and colour — dark, light, dark, light, colour — rather than a run of
 * look-alikes. The `variant` seed (post count + slide index) walks this list, so
 * every slide in a carousel gets a different surface and consecutive posts start
 * at a different point.
 */
/** HSL-style saturation, 0 (grey) to 1 (pure colour). */
function saturation(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

function surfaceRotation(b: Base): (() => Surface)[] {
  const P = b.primary;
  // A black or charcoal brand tinted toward white is just grey — the dull
  // mid-grey slides a barber shop got. Take the light surfaces' colour from
  // the accent instead (a gold accent gives warm cream), when there is one.
  const T = saturation(P) < 0.12 && saturation(b.accent) >= 0.12 ? b.accent : P;
  const darkBg = luminance(P) > 0.5 ? darken(P, 0.62) : darken(P, 0.16);
  const darkGrad: [string, string] = [lighten(darkBg, 0.1), darken(darkBg, 0.22)];
  return [
    () => flatSurface(darkBg, b, darkGrad),                                 // 0 dark gradient
    () => flatSurface(lighten(T, 0.9), b),                                  // 1 cream paper
    () => flatSurface(P, b, [lighten(P, 0.05), darken(P, 0.18)]),           // 2 solid brand
    () => flatSurface(lighten(T, 0.76), b),                                 // 3 soft pastel tint
    () => accentSurface(b),                                                 // 4 accent panel
    () => borderedPaper(b),                                                 // 5 framed paper
    () => splitSurface(b),                                                  // 6 colour split
  ];
}

/**
 * Decorative arrangements, drawn in the surface's own `deco`/`accent` colours so
 * each reads on light or dark. These sit behind the words and never compete.
 * A far larger library than before — combined with 7 surfaces and 4 type styles,
 * the same headline can come out hundreds of visibly different ways.
 */
const COMPOSITIONS: ((p: Palette) => string)[] = [
  // 0 — glow top-right, ring bottom-left
  (p) => `
    <circle cx="${CANVAS - 120}" cy="140" r="420" fill="url(#glow)"/>
    <circle cx="${CANVAS - 60}" cy="60" r="230" fill="${p.deco}" opacity="0.06"/>
    <circle cx="120" cy="${CANVAS_H - 90}" r="170" fill="none" stroke="${p.deco}" stroke-opacity="0.08" stroke-width="2"/>`,
  // 1 — glow bottom-left, soft disc top-left
  (p) => `
    <circle cx="90" cy="${CANVAS_H - 120}" r="430" fill="url(#glow)"/>
    <circle cx="140" cy="120" r="190" fill="${p.deco}" opacity="0.05"/>
    <circle cx="${CANVAS - 130}" cy="${CANVAS_H - 150}" r="150" fill="none" stroke="${p.deco}" stroke-opacity="0.09" stroke-width="2"/>`,
  // 2 — wide glow across the top, horizon rule
  (p) => `
    <ellipse cx="${CANVAS / 2}" cy="-40" rx="620" ry="360" fill="url(#glow)"/>
    <rect x="0" y="${CANVAS_H - 150}" width="${CANVAS}" height="2" fill="${p.deco}" opacity="0.10"/>
    <circle cx="${CANVAS - 110}" cy="${CANVAS_H - 300}" r="120" fill="${p.deco}" opacity="0.05"/>`,
  // 3 — two offset rings, glow low-right
  (p) => `
    <circle cx="${CANVAS - 80}" cy="${CANVAS_H - 60}" r="400" fill="url(#glow)"/>
    <circle cx="${CANVAS - 200}" cy="200" r="260" fill="none" stroke="${p.deco}" stroke-opacity="0.07" stroke-width="2"/>
    <circle cx="60" cy="${CANVAS_H / 2}" r="150" fill="${p.deco}" opacity="0.04"/>`,
  // 4 — a grid of dots in the top-right, soft glow low-left
  (p) => {
    const gap = 54, cols = 5, rows = 4, ox = CANVAS - 96 - (cols - 1) * gap, oy = 120;
    let dots = '';
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        dots += `<circle cx="${ox + i * gap}" cy="${oy + j * gap}" r="7" fill="${p.deco}" opacity="0.13"/>`;
    return `<circle cx="110" cy="${CANVAS_H - 110}" r="360" fill="url(#glow)"/>${dots}`;
  },
  // 5 — concentric arcs sweeping out of the bottom-left corner
  (p) => {
    let arcs = '';
    for (const r of [140, 260, 380, 500])
      arcs += `<circle cx="0" cy="${CANVAS_H}" r="${r}" fill="none" stroke="${p.deco}" stroke-opacity="0.09" stroke-width="2.5"/>`;
    return `<circle cx="${CANVAS - 120}" cy="150" r="240" fill="url(#glow)"/>${arcs}`;
  },
  // 6 — diagonal stripes bleeding off the top-right
  (p) => {
    let s = '';
    for (let i = 0; i < 6; i++) {
      const o = i * 48;
      s += `<line x1="${CANVAS - 380 + o}" y1="-20" x2="${CANVAS + 60 + o}" y2="420" stroke="${p.deco}" stroke-opacity="0.08" stroke-width="12" stroke-linecap="round"/>`;
    }
    return `<circle cx="140" cy="${CANVAS_H - 120}" r="300" fill="url(#glow)"/>${s}`;
  },
  // 7 — scattered plus-marks, a light confetti in the accent colour
  (p) => {
    const pts: [number, number, number][] = [
      [150, 200, 16], [CANVAS - 170, 250, 12], [CANVAS - 120, CANVAS_H - 210, 18],
      [230, CANVAS_H - 150, 13], [CANVAS / 2 + 210, 130, 11], [95, CANVAS_H / 2 + 40, 15],
    ];
    return pts
      .map(([x, y, s]) =>
        `<path d="M ${x - s} ${y} H ${x + s} M ${x} ${y - s} V ${y + s}" stroke="${p.accent}" stroke-opacity="0.5" stroke-width="4" stroke-linecap="round"/>`)
      .join('');
  },
  // 8 — a single large soft blob off the top-right, glow low-left
  (p) => `
    <path d="M 900 -60 C 1160 120 1060 400 820 440 C 620 474 540 300 630 150 C 700 30 800 -100 900 -60 Z" fill="${p.deco}" opacity="0.06"/>
    <circle cx="120" cy="${CANVAS_H - 100}" r="240" fill="url(#glow)"/>`,
  // 9 — minimal: just breathing room and the faintest wash
  (p) => `<circle cx="${CANVAS - 140}" cy="${CANVAS_H - 140}" r="300" fill="url(#glow)"/>`,
  // ── Below: a second vocabulary. Everything above leans on circles/glows —
  // the tell an owner spotted, since every Handled carousel read the same. These
  // are lines, angles, and edges: no two feeds should share a signature look.
  // 10 — editorial rule stack, top-left
  (p) => {
    let r = '';
    for (let i = 0; i < 5; i++)
      r += `<rect x="96" y="${150 + i * 26}" width="${170 + i * 34}" height="2" fill="${p.deco}" opacity="0.13"/>`;
    return r;
  },
  // 11 — corner brackets, an editorial frame on two corners
  (p) => {
    const m = 72, L = 132;
    return `
    <path d="M ${m} ${m + L} V ${m} H ${m + L}" fill="none" stroke="${p.accent}" stroke-opacity="0.16" stroke-width="3"/>
    <path d="M ${CANVAS - m - L} ${CANVAS_H - m} H ${CANVAS - m} V ${CANVAS_H - m - L}" fill="none" stroke="${p.accent}" stroke-opacity="0.16" stroke-width="3"/>`;
  },
  // 12 — a column of chevrons down the right edge
  (p) => {
    let c = '';
    for (let i = 0; i < 7; i++) {
      const y = 130 + i * 122;
      c += `<path d="M ${CANVAS - 180} ${y} l 58 40 l -58 40" fill="none" stroke="${p.deco}" stroke-opacity="0.10" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return c;
  },
  // 13 — outlined triangles, scattered
  (p) => {
    const t: [number, number, number][] = [
      [170, 230, 42], [CANVAS - 190, 190, 30], [CANVAS - 150, CANVAS_H - 230, 48],
      [250, CANVAS_H - 180, 34], [CANVAS / 2 + 190, 150, 26],
    ];
    return t
      .map(([x, y, s]) => `<path d="M ${x} ${y - s} L ${x + s} ${y + s} L ${x - s} ${y + s} Z" fill="none" stroke="${p.deco}" stroke-opacity="0.11" stroke-width="2.5"/>`)
      .join('');
  },
  // 14 — concentric squares nested into the bottom-right corner
  (p) => {
    let s = '';
    for (const d of [120, 250, 380, 510])
      s += `<rect x="${CANVAS - 60 - d}" y="${CANVAS_H - 60 - d}" width="${d}" height="${d}" fill="none" stroke="${p.deco}" stroke-opacity="0.075" stroke-width="2"/>`;
    return s;
  },
  // 15 — topographic waves rolling across the lower half
  (p) => {
    let w = '';
    for (let i = 0; i < 5; i++) {
      const y = CANVAS_H - 70 - i * 74;
      w += `<path d="M -20 ${y} q 180 -60 360 0 t 360 0 t 360 0 t 360 0" fill="none" stroke="${p.deco}" stroke-opacity="0.09" stroke-width="2.5"/>`;
    }
    return w;
  },
  // 16 — a crosshatch mesh block in the top-right
  (p) => {
    let g = '';
    const gap = 40, x0 = CANVAS - 360, y0 = 60;
    for (let i = 0; i <= 8; i++)
      g += `<line x1="${x0 + i * gap}" y1="${y0}" x2="${x0 + i * gap}" y2="${y0 + 320}" stroke="${p.deco}" stroke-opacity="0.07" stroke-width="1.5"/>`;
    for (let j = 0; j <= 8; j++)
      g += `<line x1="${x0}" y1="${y0 + j * gap}" x2="${x0 + 320}" y2="${y0 + j * gap}" stroke="${p.deco}" stroke-opacity="0.07" stroke-width="1.5"/>`;
    return g;
  },
  // 17 — measurement ticks marching down the left edge
  (p) => {
    let t = '';
    for (let i = 0; i < 12; i++) {
      const y = 130 + i * 70, long = i % 3 === 0;
      t += `<line x1="72" y1="${y}" x2="${72 + (long ? 46 : 24)}" y2="${y}" stroke="${p.deco}" stroke-opacity="0.13" stroke-width="${long ? 3 : 2}"/>`;
    }
    return t;
  },
  // 18 — a faint field of diagonal hairlines, whole canvas
  (p) => {
    let d = '';
    for (let i = -2; i < 14; i++) {
      const x = i * 100;
      d += `<line x1="${x}" y1="0" x2="${x + CANVAS}" y2="${CANVAS_H}" stroke="${p.deco}" stroke-opacity="0.05" stroke-width="1.5"/>`;
    }
    return d;
  },
  // 19 — halftone: dots shrinking left-to-right, a gradient of marks
  (p) => {
    let dots = '';
    const cols = 7, rows = 5, gap = 60, ox = CANVAS - 96 - (cols - 1) * gap, oy = 140;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        dots += `<circle cx="${ox + i * gap}" cy="${oy + j * gap}" r="${2 + (cols - 1 - i) * 1.5}" fill="${p.deco}" opacity="0.12"/>`;
    return dots;
  },
];

/**
 * Choose the look for one slide.
 *
 * A deck alternates VALUE slide-to-slide — dark, light, dark, light — with the
 * CTA slide flooded in the accent colour. That rhythm is what makes a swipe
 * feel designed instead of one card recoloured five times; every surface still
 * derives from the same brand palette, so the set stays cohesive. `seed`
 * (shared by the whole carousel) anchors WHICH dark and WHICH light the deck
 * uses and whether it leads dark or light, so consecutive posts differ;
 * `variant` (the slide index) walks the alternation and moves the shapes.
 */
function pickLook(
  theme: BrandTheme,
  seed: number,
  variant: number,
  kind?: SlideKind,
): { p: Palette; bg: string } {
  const b = basePalette(theme);
  const rotation = surfaceRotation(b);
  const s = Math.abs(seed);
  // Pools by value, guarded by the brand's own luminance: a light primary
  // makes "solid brand" a light surface, so it swaps pools.
  const primaryIsLight = luminance(b.primary) > 0.5;
  const darkPool = primaryIsLight ? [0] : [0, 2];
  const lightPool = primaryIsLight ? [1, 3, 5, 2] : [1, 3, 5];
  const dark = darkPool[s % darkPool.length];
  const light = lightPool[s % lightPool.length];
  const leadsDark = s % 2 === 0;
  const idx =
    kind === 'cta'
      ? 4 // accent flood — the closing slide pops (rotation[4] = accentSurface)
      : (variant % 2 === 0) === leadsDark
        ? dark
        : light;
  const surf = rotation[idx]();
  let bg = surf.bg;
  if (surf.allowDeco) {
    // Offset by the seed as well as the slide index so two carousels that
    // happen to share a surface still don't repeat the same run of shapes.
    const i = Math.abs(seed * 3 + variant * 5) % COMPOSITIONS.length;
    bg += COMPOSITIONS[i](surf.p);
  }
  return { p: surf.p, bg };
}

/**
 * Photo background. The scrim is the whole trick: a real photo with a graduated
 * wash of the brand color underneath the type keeps text readable on *any*
 * image while still looking designed rather than slapped together.
 */
/** Where the 'frame' photo layout puts its inset print. */
const FRAME = { x: 64, y: 64, w: CANVAS - 128, h: 760, r: 30 };

function photoFrame(p: Palette, photo: string, layout: PhotoLayout): string {
  const bandH = Math.round(CANVAS_H * 0.5);
  const defs = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${p.bgTop}"/>
        <stop offset="1" stop-color="${p.bgBottom}"/>
      </linearGradient>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0"    stop-color="${p.bgBottom}" stop-opacity="0.30"/>
        <stop offset="0.42" stop-color="${p.bgBottom}" stop-opacity="0.55"/>
        <stop offset="1"    stop-color="${p.bgBottom}" stop-opacity="0.92"/>
      </linearGradient>
      <linearGradient id="bandFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${p.bgBottom}" stop-opacity="0.15"/>
        <stop offset="1" stop-color="${p.bgBottom}" stop-opacity="0.55"/>
      </linearGradient>
    </defs>`;

  // preserveAspectRatio "slice" = cover: fills the square, crops the overflow.
  const img = (y: number, h: number) =>
    `<image href="${photo}" x="0" y="${y}" width="${CANVAS}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;

  if (layout === 'band') {
    return `${defs}
      <rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#bg)"/>
      ${img(0, bandH)}
      <rect width="${CANVAS}" height="${bandH}" fill="url(#bandFade)"/>
      <circle cx="${CANVAS - 90}" cy="${bandH + 150}" r="200" fill="${p.deco}" opacity="0.05"/>`;
  }

  if (layout === 'frame') {
    // A print on a mat: the photo inset with an even margin and soft corners,
    // words underneath on the brand colour. Reads as curated rather than
    // full-bleed, which breaks up a feed of edge-to-edge photos.
    const f = FRAME;
    return `${defs}
      <rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#bg)"/>
      <clipPath id="frameClip"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${f.r}"/></clipPath>
      <image href="${photo}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#frameClip)"/>
      <rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${f.r}" fill="none" stroke="${p.fg}" stroke-opacity="0.18" stroke-width="2"/>`;
  }

  if (layout === 'card') {
    // Photo stays mostly clear; the type lives in its own panel.
    return `${defs}
      ${img(0, CANVAS_H)}
      <rect width="${CANVAS}" height="${CANVAS_H}" fill="${p.bgBottom}" opacity="0.34"/>`;
  }

  // full — photo edge to edge with a graduated scrim for legibility.
  return `${defs}
    ${img(0, CANVAS_H)}
    <rect width="${CANVAS}" height="${CANVAS_H}" fill="url(#scrim)"/>
    <circle cx="${CANVAS - 60}" cy="60" r="230" fill="${p.deco}" opacity="0.05"/>`;
}

/** The floating panel used by the 'card' photo layout, sized to its content. */
function cardPanel(p: Palette, y: number, h: number): string {
  const m = 96;
  const w = CANVAS - m * 2;
  return `
    <rect x="${m}" y="${y}" width="${w}" height="${h}" rx="36"
          fill="${p.bgBottom}" opacity="0.90"/>
    <rect x="${m}" y="${y}" width="${w}" height="${h}" rx="36"
          fill="none" stroke="${p.fg}" stroke-opacity="0.14" stroke-width="2"/>`;
}

/** A rounded "pill" badge, horizontally centered on cx. */
function pill(cx: number, cy: number, text: string, p: Palette, t: TypeSet): string {
  const fs = 30;
  const w = Math.round(text.length * fs * 0.66) + 72;
  const h = 62;
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${p.accent}"/>
    <text x="${cx}" y="${cy + fs * 0.35}" text-anchor="middle" font-family="${t.body}" font-size="${fs}" font-weight="600" letter-spacing="2" fill="${p.onAccent}">${esc(text.toUpperCase())}</text>
  `;
}

/** Centered brand footer with a small accent dot. */
function footerCentered(text: string, p: Palette, t: TypeSet): string {
  if (!text) return '';
  const fs = 32;
  const y = CANVAS_H - 92;
  return `
    <g>
      <circle cx="${CANVAS / 2 - text.length * fs * 0.31 - 20}" cy="${y - fs * 0.32}" r="8" fill="${p.accent}"/>
      <text x="${CANVAS / 2 + 8}" y="${y}" text-anchor="middle" font-family="${t.body}" font-size="${fs}" font-weight="600" letter-spacing="1" fill="${p.fg}">${esc(text)}</text>
    </g>
  `;
}

/** Left-aligned brand footer with a small accent square to the left. */
function footerLeft(text: string, x: number, p: Palette, t: TypeSet): string {
  if (!text) return '';
  const fs = 32;
  const y = CANVAS_H - 92;
  return `
    <rect x="${x}" y="${y - fs * 0.66}" width="16" height="16" rx="4" fill="${p.accent}"/>
    <text x="${x + 36}" y="${y}" font-family="${t.body}" font-size="${fs}" font-weight="600" letter-spacing="1" fill="${p.fg}">${esc(text)}</text>
  `;
}

/**
 * The real logo, composited into the footer as a small badge.
 *
 * On a white chip on purpose: a logo can be any colour on any background, and a
 * dark logo (the common case for small businesses) would vanish on a dark or
 * brand-coloured surface. A clean white chip guarantees it reads everywhere and
 * looks intentional — a sticker, not a floating cut-out. `preserveAspectRatio`
 * = meet fits ANY logo shape into the box without distortion, so we never need
 * the logo's dimensions. (Limitation: a white/pale logo on its own transparent
 * background will read faintly on the white chip — rare, and better than a dark
 * logo vanishing on a dark slide. A luminance-aware chip colour is a later
 * refinement.)
 */
function logoBadge(dataUri: string, centered: boolean, pad: number): string {
  // A compact SQUARE chip, not a banner. The wide 190px pill read as a UI
  // artifact stamped on the art — the worst thing on an otherwise designed
  // slide. A small square is a sticker: present, branded, ignorable.
  const chip = 68;
  const y = CANVAS_H - 92 - chip / 2;
  const x = centered ? CANVAS / 2 - chip / 2 : pad;
  const inset = 10;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${chip}" height="${chip}" rx="18" fill="#FFFFFF" stroke="#1A140D" stroke-opacity="0.08" stroke-width="1"/>
      <image x="${x + inset}" y="${y + inset}" width="${chip - inset * 2}" height="${chip - inset * 2}" href="${dataUri}" preserveAspectRatio="xMidYMid meet"/>
    </g>`;
}

/** A pill-shaped call-to-action button with a cleanly drawn arrow. */
function ctaButton(cx: number, cy: number, label: string, p: Palette, t: TypeSet): string {
  const fs = 30;
  const upper = label.toUpperCase();
  const arrowW = 46;
  const w = Math.round(upper.length * fs * 0.7) + 96 + arrowW;
  const h = 66;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const textCx = cx - arrowW / 2;
  const ax = x + w - 56;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${p.accent}"/>
    <text x="${textCx}" y="${cy + fs * 0.35}" text-anchor="middle" font-family="${t.body}" font-size="${fs}" font-weight="600" letter-spacing="2" fill="${p.onAccent}">${esc(upper)}</text>
    <line x1="${ax - 16}" y1="${cy}" x2="${ax + 16}" y2="${cy}" stroke="${p.onAccent}" stroke-width="5" stroke-linecap="round"/>
    <path d="M ${ax} ${cy - 11} L ${ax + 17} ${cy} L ${ax} ${cy + 11}" fill="none" stroke="${p.onAccent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

/* ── stack layout ──────────────────────────────────────────────────────── */
/**
 * One element in the vertical stack. `render` is given the y of the block's
 * top edge; `gap` is the breathing room that follows it. Measuring first and
 * drawing second is what lets the same design center itself correctly whether
 * it's on a full canvas, inside a card, or under a photo band.
 */
interface Block {
  h: number;
  gap: number;
  render: (y: number) => string;
}

/** Total height of a stack: every block plus the gaps between them. */
function measure(blocks: Block[]): number {
  return blocks.reduce(
    (sum, b, i) => sum + b.h + (i < blocks.length - 1 ? b.gap : 0),
    0,
  );
}

function stack(blocks: Block[], zoneTop: number, zoneBottom: number): string {
  const total = measure(blocks);
  let y = zoneTop + Math.max(0, (zoneBottom - zoneTop - total) / 2);
  const out: string[] = [];
  for (const b of blocks) {
    out.push(b.render(y));
    y += b.h + b.gap;
  }
  return out.join('');
}


/* ── main entry ────────────────────────────────────────────────────────── */

/** What one pass of the layout builder produced at a given type scale. */
interface Built {
  blocks: Block[];
  /** Vertical placement of the stack inside its zone. */
  anchor: 'center' | 'bottom' | 'top';
  /** Fixed-position SVG drawn under the stack (split's colour block). */
  under?: string;
  /** Fixed-position SVG drawn over the stack (poster's brand line). */
  over?: string;
  /** Overrides the zone the stack is fitted into. */
  zone?: [number, number];
  /** Set when something outside the stack didn't fit at this scale. */
  overflow?: boolean;
}

export function renderSlideSvg(spec: SlideSpec, theme: BrandTheme): string {
  const layout: PhotoLayout | undefined = spec.photo
    ? (spec.photoLayout ?? 'full')
    : undefined;
  const seed = spec.seed ?? spec.variant ?? 0;
  // Photo slides keep the consistent dark scrim. Text-only slides take their
  // surface from the SET's seed, so a carousel reads as one designed piece;
  // `seed` falls back to `variant` for single one-off graphics that have no set.
  const surface = layout
    ? undefined
    : pickLook(theme, seed, spec.variant ?? 0, spec.kind);
  const p = surface ? surface.p : photoPalette(theme);
  const t = typeSet(theme.style);
  const footer = spec.footer ?? theme.brandName ?? '';
  const wordSlide = spec.kind === 'title' || spec.kind === 'body';

  // The arrangement of the words. Designed word slides take the post's text
  // layout; photo slides keep their photo composition, except that a
  // full-bleed photo can carry poster type (huge, bottom-anchored) when that
  // is the post's layout.
  let tl: TextLayout = 'stack';
  if (wordSlide) {
    const chosen =
      spec.textLayout ?? textLayoutFor(seed, spec.coverHeadline ?? spec.headline);
    if (!layout) tl = chosen;
    else if (layout === 'full' && chosen === 'poster') tl = 'poster';
  }
  // A numeral title needs a number to lead with; an inside slide leads with
  // its step number instead ("01", "02"…).
  const lead = tl === 'numeral' ? leadNumber(spec.headline) : null;
  const stepNo =
    tl === 'numeral' && spec.kind === 'body' && spec.variant !== undefined
      ? String(spec.variant).padStart(2, '0')
      : null;
  if (tl === 'numeral' && !(spec.kind === 'title' ? lead : stepNo ?? lead)) {
    tl = Math.floor(Math.abs(seed) / 5) % 2 === 0 ? 'highlight' : 'stack';
  }

  const BAND_H = Math.round(CANVAS_H * 0.5);
  const CARD_M = 96;
  const CARD_PAD = 70;

  // Text is confined to a zone so it never collides with the photo band or the
  // edge of a card. 'card' gets its final zone after we measure the content.
  const pad =
    layout === 'card' ? CARD_M + 56 : tl === 'poster' || tl === 'split' ? 90 : tl === 'stack' ? 110 : 100;
  let zoneTop = 190;
  let zoneBottom = CANVAS_H - 190;
  if (layout === 'band') {
    zoneTop = BAND_H + 62;
    zoneBottom = CANVAS_H - 78;
  } else if (layout === 'frame') {
    zoneTop = FRAME.y + FRAME.h + 56;
    zoneBottom = CANVAS_H - 72;
  }

  const centered =
    layout === 'card' ||
    tl === 'highlight' ||
    spec.kind === 'quote' ||
    spec.kind === 'promo' ||
    spec.kind === 'cta';
  const maxW = CANVAS - pad * 2;
  const cx = CANVAS / 2;
  const anchor = centered ? ' text-anchor="middle"' : '';
  const tsp = (lines: string[], startY: number, lh: number) =>
    centered
      ? tspansCentered(lines, cx, startY, lh)
      : tspansLeft(lines, pad, startY, lh);

  // For title/body the eyebrow already carries the brand name — repeating it in
  // a footer just prints the business name twice.
  const eyebrowIsBrand = wordSlide;
  // Band, card and frame layouts have no room for a pinned footer, so it joins
  // the stack instead of floating at the bottom of the canvas.
  const footerInStack = layout === 'band' || layout === 'card' || layout === 'frame';
  const brandLine = (theme.brandName || footer || 'New').toUpperCase();

  const headFace: Face = { family: t.head, weight: t.headWeight, tracking: t.headTracking };
  const bodyFace = (weight: number): Face => ({ family: t.body, weight });
  const head = (s: string) => (t.headUpper ? s.toUpperCase() : s);
  const headCap = capHeight(t.head, t.headWeight);

  /** A paragraph block in the body face. */
  const paragraph = (
    text: string,
    fs: number,
    lh: number,
    maxLines: number,
    gap: number,
    weight = 400,
    width = maxW,
  ): Block => {
    const lines = clampLines(wrap(text, fs, width, 0.54, bodyFace(weight)), maxLines);
    return {
      h: lines.length * fs * lh,
      gap,
      render: (y) =>
        `<text${anchor} font-family="${t.body}" font-size="${fs}" font-weight="${weight}" fill="${p.fgSoft}" xml:space="preserve">${tsp(lines, y + fs * 0.8, fs * lh)}</text>`,
    };
  };

  /** A headline block in the head face. */
  const headline = (
    text: string,
    fs: number,
    lh: number,
    maxLines: number,
    gap: number,
    fill = p.fg,
  ): Block => {
    const lines = clampLines(wrap(head(text), fs, maxW, 0.58, headFace, true), maxLines);
    return {
      h: lines.length * fs * lh,
      gap,
      render: (y) =>
        `<text${anchor} font-family="${t.head}" font-size="${fs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${fill}" xml:space="preserve">${tsp(lines, y + fs * 0.8, fs * lh)}</text>`,
    };
  };

  /**
   * Builds the slide's blocks at a given type scale. Called repeatedly by the
   * auto-fit loop below: measure, and if the content is taller than its zone
   * (or a line is wider than the frame), step the type down and try again.
   * That's what guarantees a headline never runs off the frame, however long
   * the owner's text is.
   */
  const build = (scale: number): Built => {
    // Gaps shrink with the type, otherwise fixed whitespace eats the savings.
    const g = (n: number) => Math.round(n * scale);
    // Line ceilings are a LAST RESORT, not a fitting strategy. They sit well
    // above what a sensible headline needs so that the auto-fit loop below
    // shrinks the type to fit the words — a clamp that bites early would make
    // the content "fit" at full size and silently truncate the headline to an
    // ellipsis ("floss for a…"), which reads as broken rather than designed.
    // Photo band/card zones are genuinely tighter, so they keep lower ceilings.
    const tight = layout === 'band' || layout === 'frame';
    const headMax = tight ? 4 : layout === 'card' ? 5 : 7;
    const bodyMax = tight ? 3 : layout === 'card' ? 4 : 5;
    const blocks: Block[] = [];
    const isTitle = spec.kind === 'title';

    if (spec.kind === 'quote') {
      const qFs = Math.round(78 * scale);
      const qLines = clampLines(
        wrap(spec.headline, qFs, maxW, 0.5, { family: t.quote, weight: 500 }, true),
        5,
      );
      const qLH = qFs * 1.28;
      if (layout !== 'card') {
        const mFs = Math.round(300 * scale);
        blocks.push({
          h: mFs * 0.42,
          gap: g(4),
          render: (y) =>
            `<text x="${cx}" y="${y + mFs * 0.72}" text-anchor="middle" font-family="${t.quote}" font-size="${mFs}" font-weight="700" fill="${p.accent}" opacity="0.35">&#8220;</text>`,
        });
      }
      blocks.push({
        h: qLines.length * qLH,
        gap: g(54),
        render: (y) =>
          `<text text-anchor="middle" font-family="${t.quote}" font-size="${qFs}"${t.quoteItalic ? ' font-style="italic"' : ''} font-weight="500" fill="${p.fg}" xml:space="preserve">${tspansCentered(qLines, cx, y + qFs * 0.8, qLH)}</text>`,
      });
      blocks.push({
        h: 5,
        gap: footer ? g(48) : 0,
        render: (y) =>
          `<rect x="${cx - 60}" y="${y}" width="120" height="5" rx="2.5" fill="${p.accent}"/>`,
      });
      if (footer) {
        blocks.push({
          h: 34,
          gap: g(0),
          render: (y) =>
            `<text x="${cx}" y="${y + 28}" text-anchor="middle" font-family="${t.body}" font-size="34" font-weight="600" letter-spacing="1" fill="${p.fgSoft}">${esc(footer)}</text>`,
        });
      }
      return { blocks, anchor: 'center' };
    }

    if (spec.kind === 'promo') {
      blocks.push({
        h: 62,
        gap: g(64),
        render: (y) => pill(cx, y + 31, 'Special Offer', p, t),
      });
      const short = spec.headline.replace(/\s+/g, '').length <= 8;
      const hFs = Math.round((short ? 190 : 124) * scale);
      blocks.push(headline(spec.headline, hFs, 1.04, headMax, spec.body ? g(56) : 0));
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(46 * scale), 1.3, bodyMax, 0, 500));
    } else if (spec.kind === 'cta') {
      const hFs = Math.round(88 * scale);
      blocks.push(headline(spec.headline, hFs, 1.08, headMax, spec.body ? g(44) : g(66)));
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(44 * scale), 1.3, bodyMax, g(66)));
      blocks.push({
        h: 66,
        gap: g(0),
        render: (y) => ctaButton(cx, y + 33, spec.ctaLabel ?? 'Visit us', p, t),
      });
    } else if (tl === 'poster') {
      // A gig poster: the headline is the picture. Huge, tight, bottom-left,
      // with the brand line pinned top-left and a hairline before the body.
      const hFs = Math.round((isTitle ? 172 : 126) * scale);
      // All-caps faces can sit tight; lowercase needs room for descenders
      // ("get" over "this" collided at 0.98).
      const tight = !!t.headUpper;
      blocks.push(headline(spec.headline, hFs, tight ? 0.98 : 1.05, headMax, g(44)));
      blocks.push({
        h: 6,
        gap: spec.body ? g(40) : 0,
        render: (y) => `<rect x="${pad}" y="${y}" width="120" height="6" rx="3" fill="${p.accent}"/>`,
      });
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(42 * scale), 1.36, bodyMax, 0));
      const over = `<text x="${pad}" y="124" font-family="${t.body}" font-size="28" font-weight="600" letter-spacing="4" fill="${p.accent}">${esc(brandLine)}</text>`;
      return {
        blocks,
        anchor: 'bottom',
        over,
        zone: [200, layout ? CANVAS_H - 120 : CANVAS_H - 160],
      };
    } else if (tl === 'highlight') {
      // Marker highlights: each headline line sits on its own colour bar, the
      // way a person highlights the line that matters.
      const hFs = Math.round((isTitle ? 104 : 80) * scale);
      const padX = Math.round(hFs * 0.24);
      const barH = Math.round(hFs * 1.18);
      const step = barH + Math.round(hFs * 0.14);
      const lines = clampLines(wrap(head(spec.headline), hFs, maxW - padX * 2, 0.58, headFace, true), headMax);
      blocks.push({
        h: 30,
        gap: g(46),
        render: (y) =>
          `<text x="${cx}" y="${y + 26}" text-anchor="middle" font-family="${t.body}" font-size="30" font-weight="600" letter-spacing="4" fill="${p.accent}">${esc(brandLine)}</text>`,
      });
      blocks.push({
        h: lines.length * step - (step - barH),
        gap: spec.body ? g(54) : 0,
        render: (y) =>
          lines
            .map((l, i) => {
              const w =
                (textWidth(l, t.head, hFs, t.headWeight, t.headTracking) ?? l.length * hFs * 0.58) +
                padX * 2;
              const top = y + i * step;
              const base = top + barH / 2 + (headCap * hFs) / 2;
              return `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="${barH}" rx="${Math.round(barH * 0.12)}" fill="${p.accent}"/>` +
                `<text x="${cx}" y="${base}" text-anchor="middle" font-family="${t.head}" font-size="${hFs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${p.onAccent}" xml:space="preserve">${esc(l)}</text>`;
            })
            .join(''),
      });
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(42 * scale), 1.36, bodyMax, 0));
    } else if (tl === 'numeral') {
      // A giant number leads: the price, the count, or the step.
      const num = stepNo ?? lead!.num;
      const before = stepNo ? '' : lead!.before;
      const after = stepNo ? spec.headline : lead!.after;
      const sub = Math.round((isTitle ? 88 : 76) * scale);
      if (before) blocks.push(headline(before, sub, 1.06, 3, g(28)));
      let nFs = Math.round((stepNo ? 300 : 400) * scale);
      const nW = textWidth(num, t.head, nFs, t.headWeight, t.headTracking);
      if (nW && nW > maxW) nFs = Math.floor((nFs * maxW) / nW);
      // Playfair's figures are old-style: 3, 4, 5, 7 and 9 drop below the
      // baseline, so the number needs room under it or it hits the next line.
      const descends = /playfair/i.test(t.head) && /[34579]/.test(num);
      blocks.push({
        h: nFs * (headCap + (descends ? 0.24 : 0.02)),
        gap: after ? g(40) : spec.body ? g(48) : 0,
        render: (y) =>
          `<text x="${pad}" y="${y + nFs * headCap}" font-family="${t.head}" font-size="${nFs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${p.accent}">${esc(num)}</text>`,
      });
      if (after) blocks.push(headline(after, sub, 1.06, 4, spec.body ? g(40) : 0));
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(42 * scale), 1.36, bodyMax, 0));
    } else if (tl === 'split') {
      // Colour-blocked: a solid band of the accent holds the headline,
      // bottom-anchored; the paragraph sits on the surface below it.
      const hFs = Math.round((isTitle ? 132 : 100) * scale);
      const lh = hFs * 1.02;
      const hLines = clampLines(wrap(head(spec.headline), hFs, maxW, 0.58, headFace, true), headMax);
      const headH = hLines.length * lh;
      const want = 230 + headH + 80;
      const blockH = Math.round(Math.min(Math.max(want, CANVAS_H * 0.44), CANVAS_H * 0.64));
      const firstBase = blockH - 80 - headH + hFs * 0.8;
      const under =
        `<rect width="${CANVAS}" height="${blockH}" fill="${p.accent}"/>` +
        `<text x="${pad}" y="124" font-family="${t.body}" font-size="28" font-weight="600" letter-spacing="4" fill="${p.onAccent}" opacity="0.8">${esc(brandLine)}</text>` +
        `<text font-family="${t.head}" font-size="${hFs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${p.onAccent}" xml:space="preserve">${tspansLeft(hLines, pad, firstBase, lh)}</text>`;
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(50 * scale), 1.36, bodyMax, 0, 500));
      return {
        blocks,
        anchor: 'top',
        under,
        zone: [blockH + 84, CANVAS_H - 150],
        overflow: want > CANVAS_H * 0.64,
      };
    } else {
      // stack — the classic: eyebrow, headline, rule, paragraph.
      blocks.push({
        h: 30,
        gap: g(50),
        render: (y) =>
          `<text x="${centered ? cx : pad}"${anchor} y="${y + 26}" font-family="${t.body}" font-size="30" font-weight="600" letter-spacing="4" fill="${p.accent}">${esc(brandLine)}</text>`,
      });
      // The title slide is the hook — its headline should dominate the canvas
      // the way the reference decks' hooks do, not match the body slides.
      const hFs = Math.round((isTitle ? 124 : 84) * scale);
      blocks.push(headline(spec.headline, hFs, 1.06, headMax, g(44)));
      blocks.push({
        h: 7,
        gap: spec.body ? g(50) : g(0),
        render: (y) =>
          `<rect x="${centered ? cx - 70 : pad}" y="${y}" width="140" height="7" rx="3.5" fill="${p.accent}"/>`,
      });
      if (spec.body) blocks.push(paragraph(spec.body, Math.round(44 * scale), 1.35, bodyMax, 0));
    }

    if (footerInStack && footer && !eyebrowIsBrand) {
      const last = blocks[blocks.length - 1];
      if (last) last.gap = 48;
      blocks.push({
        h: 32,
        gap: g(0),
        render: (y) =>
          `<text x="${cx}" y="${y + 26}" text-anchor="middle" font-family="${t.body}" font-size="30" font-weight="600" letter-spacing="1" fill="${p.fgSoft}">${esc(footer)}</text>`,
      });
    }
    // On a full-bleed photo the words sit at the bottom, where the scrim is
    // darkest; at the top they fought the busiest part of the picture.
    if (layout === 'full') return { blocks, anchor: 'bottom', zone: [190, CANVAS_H - 130] };
    return { blocks, anchor: 'center' };
  };

  // Auto-fit: start roomy, step down until the content fits its zone.
  const startScale = layout === 'card' ? 0.82 : layout === 'band' || layout === 'frame' ? 0.86 : 1;
  const zoneOf = (b: Built): [number, number] => b.zone ?? [zoneTop, zoneBottom];
  const tryBuild = (scale: number): Built => {
    widestLine = 0;
    const b = build(scale);
    return b;
  };
  const fits = (b: Built, widest: number): boolean => {
    const [top, bottom] = zoneOf(b);
    return !b.overflow && measure(b.blocks) <= bottom - top && widest <= maxW + 1;
  };

  let built = tryBuild(startScale);
  let widest = widestLine;
  let cardBox: { y: number; h: number } | undefined;

  if (layout === 'card') {
    // The card sizes itself to the type rather than the type squeezing into a
    // fixed box, so short posts don't get a half-empty panel.
    const cardH = Math.min(
      Math.max(measure(built.blocks) + CARD_PAD * 2, 360),
      CANVAS_H - 160,
    );
    // Low in the frame, not centred: most photos put their subject in the
    // middle, and a centred card sat right on top of it (the dog vanished).
    const cardY = Math.max(80, CANVAS_H - cardH - 110);
    zoneTop = cardY + CARD_PAD;
    zoneBottom = cardY + cardH - CARD_PAD;
    cardBox = { y: cardY, h: cardH };
  }

  let scale = startScale;
  for (let s = startScale - 0.05; !fits(built, widest) && s >= 0.38; s -= 0.05) {
    built = tryBuild(s);
    widest = widestLine;
    scale = s;
  }
  // One unbreakable word can still be wider than the frame at the smallest
  // step (a long name in poster type). Shrink exactly enough for it to fit:
  // smaller type beats a word cut off by the edge of the image.
  for (let i = 0; i < 3 && widest > maxW + 1; i++) {
    scale *= (maxW / widest) * 0.98;
    built = tryBuild(scale);
    widest = widestLine;
  }

  const [zTop, zBottom] = zoneOf(built);
  const stackTop =
    built.anchor === 'bottom' ? Math.max(zTop, zBottom - measure(built.blocks)) : zTop;
  // stack() centres within [top, bottom]; a top-anchored stack is centred in
  // a zone exactly its own height.
  const stackBottom = built.anchor === 'top' ? zTop + measure(built.blocks) : zBottom;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS} ${CANVAS_H}">`,
    spec.photo ? photoFrame(p, spec.photo, layout!) : surface!.bg,
  ];
  if (built.under) parts.push(built.under);
  if (cardBox) parts.push(cardPanel(p, cardBox.y, cardBox.h));
  parts.push(stack(built.blocks, stackTop, stackBottom));
  if (built.over) parts.push(built.over);

  // "n / N" progress tag, top-right. Numbered progress tells the reader how
  // long the tunnel is and measurably lifts swipe-through — same principle
  // as the numbered onboarding questions.
  if (spec.total && spec.total > 1 && spec.variant !== undefined) {
    const tagFill = tl === 'split' ? p.onAccent : p.fgSoft;
    parts.push(
      `<text x="${CANVAS - 96}" y="112" text-anchor="end" font-family="${t.body}" font-size="27" font-weight="600" letter-spacing="2" fill="${tagFill}" opacity="0.9">${spec.variant + 1} / ${spec.total}</text>`,
    );
  }

  // Footer. A real logo, when we have one, is composited as a badge on word
  // slides (the surface layouts) — the actual brand mark instead of the text
  // name. It shows even on title/body slides where the text footer is skipped
  // as redundant with the eyebrow, because a logo is not redundant with a word.
  // Photo layouts (band/card/frame) keep their in-stack text footer untouched.
  if (theme.logoDataUri && !layout) {
    parts.push(logoBadge(theme.logoDataUri, centered, pad));
  } else if (!footerInStack && footer && !eyebrowIsBrand && spec.kind !== 'quote') {
    // Pinned footer, only where there's room for one below the design.
    parts.push(
      centered ? footerCentered(footer, p, t) : footerLeft(footer, pad, p, t),
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}
