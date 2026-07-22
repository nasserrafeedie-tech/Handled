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
 * Instagram square canvas.
 */

export const CANVAS = 1080;

export type SlideKind = 'title' | 'body' | 'quote' | 'promo' | 'cta';

/**
 * How a photo is used behind the type. Picking one per post is what keeps a
 * feed from looking like the same template four times a week.
 *   full — photo fills the frame, text sits on a dark scrim
 *   card — photo fills the frame, text sits in a floating card
 *   band — photo on top, solid brand color below
 */
export type PhotoLayout = 'full' | 'card' | 'band';

/**
 * Type personality. Each maps to a font pairing so a barber shop and a day spa
 * don't get the same-looking graphics. All fonts are open-source (Google Fonts).
 */
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
      return {
        head: SERIF, headWeight: 700, headTracking: 0,
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

/** Word-wrap by estimated glyph width. `factor` ≈ average glyph width / fontSize. */
function wrap(text: string, fontSize: number, maxWidth: number, factor = 0.56): string[] {
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * factor)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
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
  const bg = `${surfaceDefs(fill, pop, isLight ? 0.09 : 0.28)}<rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>`;
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
  return { p, bg: `${surfaceDefs(fill, fg, 0.10)}<rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>`, allowDeco: true };
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
    <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
    <path d="M ${CANVAS} 0 L ${CANVAS} 420 L ${CANVAS - 420} 0 Z" fill="${block}"/>
    <path d="M 0 ${CANVAS} L 0 ${CANVAS - 300} L 300 ${CANVAS} Z" fill="${pop}" opacity="0.14"/>`;
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
    <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
    <rect x="${m}" y="${m}" width="${CANVAS - m * 2}" height="${CANVAS - m * 2}" rx="26" fill="none" stroke="${pop}" stroke-opacity="0.35" stroke-width="3"/>`;
  return { p, bg, allowDeco: false };
}

/**
 * The surface rotation. Ordered so walking it slide-to-slide gives a rhythm of
 * value and colour — dark, light, dark, light, colour — rather than a run of
 * look-alikes. The `variant` seed (post count + slide index) walks this list, so
 * every slide in a carousel gets a different surface and consecutive posts start
 * at a different point.
 */
function surfaceRotation(b: Base): (() => Surface)[] {
  const P = b.primary;
  const darkBg = luminance(P) > 0.5 ? darken(P, 0.62) : darken(P, 0.16);
  const darkGrad: [string, string] = [lighten(darkBg, 0.1), darken(darkBg, 0.22)];
  return [
    () => flatSurface(darkBg, b, darkGrad),                                 // 0 dark gradient
    () => flatSurface(lighten(P, 0.9), b),                                  // 1 cream paper
    () => flatSurface(P, b, [lighten(P, 0.05), darken(P, 0.18)]),           // 2 solid brand
    () => flatSurface(lighten(P, 0.76), b),                                 // 3 soft pastel tint
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
    <circle cx="120" cy="${CANVAS - 90}" r="170" fill="none" stroke="${p.deco}" stroke-opacity="0.08" stroke-width="2"/>`,
  // 1 — glow bottom-left, soft disc top-left
  (p) => `
    <circle cx="90" cy="${CANVAS - 120}" r="430" fill="url(#glow)"/>
    <circle cx="140" cy="120" r="190" fill="${p.deco}" opacity="0.05"/>
    <circle cx="${CANVAS - 130}" cy="${CANVAS - 150}" r="150" fill="none" stroke="${p.deco}" stroke-opacity="0.09" stroke-width="2"/>`,
  // 2 — wide glow across the top, horizon rule
  (p) => `
    <ellipse cx="${CANVAS / 2}" cy="-40" rx="620" ry="360" fill="url(#glow)"/>
    <rect x="0" y="${CANVAS - 150}" width="${CANVAS}" height="2" fill="${p.deco}" opacity="0.10"/>
    <circle cx="${CANVAS - 110}" cy="${CANVAS - 300}" r="120" fill="${p.deco}" opacity="0.05"/>`,
  // 3 — two offset rings, glow low-right
  (p) => `
    <circle cx="${CANVAS - 80}" cy="${CANVAS - 60}" r="400" fill="url(#glow)"/>
    <circle cx="${CANVAS - 200}" cy="200" r="260" fill="none" stroke="${p.deco}" stroke-opacity="0.07" stroke-width="2"/>
    <circle cx="60" cy="${CANVAS / 2}" r="150" fill="${p.deco}" opacity="0.04"/>`,
  // 4 — a grid of dots in the top-right, soft glow low-left
  (p) => {
    const gap = 54, cols = 5, rows = 4, ox = CANVAS - 96 - (cols - 1) * gap, oy = 120;
    let dots = '';
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        dots += `<circle cx="${ox + i * gap}" cy="${oy + j * gap}" r="7" fill="${p.deco}" opacity="0.13"/>`;
    return `<circle cx="110" cy="${CANVAS - 110}" r="360" fill="url(#glow)"/>${dots}`;
  },
  // 5 — concentric arcs sweeping out of the bottom-left corner
  (p) => {
    let arcs = '';
    for (const r of [140, 260, 380, 500])
      arcs += `<circle cx="0" cy="${CANVAS}" r="${r}" fill="none" stroke="${p.deco}" stroke-opacity="0.09" stroke-width="2.5"/>`;
    return `<circle cx="${CANVAS - 120}" cy="150" r="240" fill="url(#glow)"/>${arcs}`;
  },
  // 6 — diagonal stripes bleeding off the top-right
  (p) => {
    let s = '';
    for (let i = 0; i < 6; i++) {
      const o = i * 48;
      s += `<line x1="${CANVAS - 380 + o}" y1="-20" x2="${CANVAS + 60 + o}" y2="420" stroke="${p.deco}" stroke-opacity="0.08" stroke-width="12" stroke-linecap="round"/>`;
    }
    return `<circle cx="140" cy="${CANVAS - 120}" r="300" fill="url(#glow)"/>${s}`;
  },
  // 7 — scattered plus-marks, a light confetti in the accent colour
  (p) => {
    const pts: [number, number, number][] = [
      [150, 200, 16], [CANVAS - 170, 250, 12], [CANVAS - 120, CANVAS - 210, 18],
      [230, CANVAS - 150, 13], [CANVAS / 2 + 210, 130, 11], [95, CANVAS / 2 + 40, 15],
    ];
    return pts
      .map(([x, y, s]) =>
        `<path d="M ${x - s} ${y} H ${x + s} M ${x} ${y - s} V ${y + s}" stroke="${p.accent}" stroke-opacity="0.5" stroke-width="4" stroke-linecap="round"/>`)
      .join('');
  },
  // 8 — a single large soft blob off the top-right, glow low-left
  (p) => `
    <path d="M 900 -60 C 1160 120 1060 400 820 440 C 620 474 540 300 630 150 C 700 30 800 -100 900 -60 Z" fill="${p.deco}" opacity="0.06"/>
    <circle cx="120" cy="${CANVAS - 100}" r="240" fill="url(#glow)"/>`,
  // 9 — minimal: just breathing room and the faintest wash
  (p) => `<circle cx="${CANVAS - 140}" cy="${CANVAS - 140}" r="300" fill="url(#glow)"/>`,
];

/**
 * Choose the look for one slide.
 *
 * `seed` picks the surface and is shared by every slide in a carousel, so the
 * set is cohesive — one post, one look. `variant` (the slide's index) only moves
 * the decorative arrangement, giving the set rhythm without breaking it apart.
 * Two different posts get different seeds and therefore different surfaces,
 * which is where the variety in a feed comes from.
 */
function pickLook(
  theme: BrandTheme,
  seed: number,
  variant: number,
): { p: Palette; bg: string } {
  const b = basePalette(theme);
  const rotation = surfaceRotation(b);
  const surf = rotation[Math.abs(seed) % rotation.length]();
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
function photoFrame(p: Palette, photo: string, layout: PhotoLayout): string {
  const bandH = Math.round(CANVAS * 0.56);
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
      <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
      ${img(0, bandH)}
      <rect width="${CANVAS}" height="${bandH}" fill="url(#bandFade)"/>
      <circle cx="${CANVAS - 90}" cy="${bandH + 150}" r="200" fill="${p.deco}" opacity="0.05"/>`;
  }

  if (layout === 'card') {
    // Photo stays mostly clear; the type lives in its own panel.
    return `${defs}
      ${img(0, CANVAS)}
      <rect width="${CANVAS}" height="${CANVAS}" fill="${p.bgBottom}" opacity="0.34"/>`;
  }

  // full — photo edge to edge with a graduated scrim for legibility.
  return `${defs}
    ${img(0, CANVAS)}
    <rect width="${CANVAS}" height="${CANVAS}" fill="url(#scrim)"/>
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
  const y = CANVAS - 92;
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
  const y = CANVAS - 92;
  return `
    <rect x="${x}" y="${y - fs * 0.66}" width="16" height="16" rx="4" fill="${p.accent}"/>
    <text x="${x + 36}" y="${y}" font-family="${t.body}" font-size="${fs}" font-weight="600" letter-spacing="1" fill="${p.fg}">${esc(text)}</text>
  `;
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
export function renderSlideSvg(spec: SlideSpec, theme: BrandTheme): string {
  const layout: PhotoLayout | undefined = spec.photo
    ? (spec.photoLayout ?? 'full')
    : undefined;
  // Photo slides keep the consistent dark scrim. Text-only slides take their
  // surface from the SET's seed, so a carousel reads as one designed piece;
  // `seed` falls back to `variant` for single one-off graphics that have no set.
  const surface = layout
    ? undefined
    : pickLook(theme, spec.seed ?? spec.variant ?? 0, spec.variant ?? 0);
  const p = surface ? surface.p : photoPalette(theme);
  const t = typeSet(theme.style);
  const footer = spec.footer ?? theme.brandName ?? '';

  const BAND_H = Math.round(CANVAS * 0.56);
  const CARD_M = 96;
  const CARD_PAD = 70;

  // Text is confined to a zone so it never collides with the photo band or the
  // edge of a card. 'card' gets its final zone after we measure the content.
  const pad = layout === 'card' ? CARD_M + 56 : 110;
  let zoneTop = 190;
  let zoneBottom = CANVAS - 190;
  if (layout === 'band') {
    zoneTop = BAND_H + 62;
    zoneBottom = CANVAS - 78;
  }

  const centered =
    layout === 'card' ||
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
  const eyebrowIsBrand = spec.kind === 'title' || spec.kind === 'body';
  // Band and card layouts have no room for a pinned footer, so it joins the
  // stack instead of floating at the bottom of the canvas.
  const footerInStack = layout === 'band' || layout === 'card';

  /**
   * Builds the slide's blocks at a given type scale. Called repeatedly by the
   * auto-fit loop below: measure, and if the content is taller than its zone,
   * step the type down and measure again. That's what guarantees a headline
   * never runs off the bottom of the frame, however long the owner's text is.
   */
  const build = (scale: number): Block[] => {
    const head = (s: string) => (t.headUpper ? s.toUpperCase() : s);
    // Gaps shrink with the type, otherwise fixed whitespace eats the savings.
    const g = (n: number) => Math.round(n * scale);
    // Line ceilings are a LAST RESORT, not a fitting strategy. They sit well
    // above what a sensible headline needs so that the auto-fit loop below
    // shrinks the type to fit the words — a clamp that bites early would make
    // the content "fit" at full size and silently truncate the headline to an
    // ellipsis ("floss for a…"), which reads as broken rather than designed.
    // Photo band/card zones are genuinely tighter, so they keep lower ceilings.
    const headMax = layout === 'band' ? 4 : layout === 'card' ? 5 : 7;
    const bodyMax = layout === 'band' ? 3 : layout === 'card' ? 4 : 5;
    const blocks: Block[] = [];

    if (spec.kind === 'quote') {
      const qFs = Math.round(78 * scale);
      const qLines = clampLines(wrap(spec.headline, qFs, maxW, 0.5), 5);
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
      return blocks;
    }

    if (spec.kind === 'promo') {
      blocks.push({
        h: 62,
        gap: g(64),
        render: (y) => pill(cx, y + 31, 'Special Offer', p, t),
      });
      const short = spec.headline.replace(/\s+/g, '').length <= 8;
      const hFs = Math.round((short ? 190 : 124) * scale);
      const hLines = clampLines(
        wrap(head(spec.headline), hFs, maxW, t.head === DISPLAY ? 0.48 : 0.6),
        headMax,
      );
      const hLH = hFs * 1.04;
      blocks.push({
        h: hLines.length * hLH,
        gap: spec.body ? g(56) : g(0),
        render: (y) =>
          `<text text-anchor="middle" font-family="${t.head}" font-size="${hFs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${p.fg}" xml:space="preserve">${tspansCentered(hLines, cx, y + hFs * 0.8, hLH)}</text>`,
      });
      if (spec.body) {
        const bFs = Math.round(46 * scale);
        const bLines = clampLines(wrap(spec.body, bFs, maxW, 0.54), bodyMax);
        blocks.push({
          h: bLines.length * bFs * 1.3,
          gap: g(0),
          render: (y) =>
            `<text text-anchor="middle" font-family="${t.body}" font-size="${bFs}" font-weight="500" fill="${p.fgSoft}" xml:space="preserve">${tspansCentered(bLines, cx, y + bFs * 0.8, bFs * 1.3)}</text>`,
        });
      }
    } else if (spec.kind === 'cta') {
      const hFs = Math.round(88 * scale);
      const hLines = clampLines(wrap(head(spec.headline), hFs, maxW, 0.58), headMax);
      const hLH = hFs * 1.08;
      blocks.push({
        h: hLines.length * hLH,
        gap: spec.body ? g(44) : g(66),
        render: (y) =>
          `<text text-anchor="middle" font-family="${t.head}" font-size="${hFs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${p.fg}" xml:space="preserve">${tspansCentered(hLines, cx, y + hFs * 0.8, hLH)}</text>`,
      });
      if (spec.body) {
        const bFs = Math.round(44 * scale);
        const bLines = clampLines(wrap(spec.body, bFs, maxW, 0.54), bodyMax);
        blocks.push({
          h: bLines.length * bFs * 1.3,
          gap: g(66),
          render: (y) =>
            `<text text-anchor="middle" font-family="${t.body}" font-size="${bFs}" font-weight="400" fill="${p.fgSoft}" xml:space="preserve">${tspansCentered(bLines, cx, y + bFs * 0.8, bFs * 1.3)}</text>`,
        });
      }
      blocks.push({
        h: 66,
        gap: g(0),
        render: (y) => ctaButton(cx, y + 33, 'Visit us', p, t),
      });
    } else {
      // title / body — editorial, with an eyebrow and a rule under the headline.
      const eyebrow = (theme.brandName || footer || 'New').toUpperCase();
      blocks.push({
        h: 30,
        gap: g(50),
        render: (y) =>
          `<text x="${centered ? cx : pad}"${anchor} y="${y + 26}" font-family="${t.body}" font-size="30" font-weight="600" letter-spacing="4" fill="${p.accent}">${esc(eyebrow)}</text>`,
      });
      const hFs = Math.round((spec.kind === 'title' ? 104 : 82) * scale);
      const hLines = clampLines(wrap(head(spec.headline), hFs, maxW, 0.58), headMax);
      const hLH = hFs * 1.06;
      blocks.push({
        h: hLines.length * hLH,
        gap: g(44),
        render: (y) =>
          `<text${anchor} font-family="${t.head}" font-size="${hFs}" font-weight="${t.headWeight}" letter-spacing="${t.headTracking}" fill="${p.fg}" xml:space="preserve">${tsp(hLines, y + hFs * 0.8, hLH)}</text>`,
      });
      blocks.push({
        h: 7,
        gap: spec.body ? g(50) : g(0),
        render: (y) =>
          `<rect x="${centered ? cx - 70 : pad}" y="${y}" width="140" height="7" rx="3.5" fill="${p.accent}"/>`,
      });
      if (spec.body) {
        const bFs = Math.round(44 * scale);
        const bLines = clampLines(wrap(spec.body, bFs, maxW, 0.54), bodyMax);
        blocks.push({
          h: bLines.length * bFs * 1.35,
          gap: g(0),
          render: (y) =>
            `<text${anchor} font-family="${t.body}" font-size="${bFs}" font-weight="400" fill="${p.fgSoft}" xml:space="preserve">${tsp(bLines, y + bFs * 0.8, bFs * 1.35)}</text>`,
        });
      }
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
    return blocks;
  };

  // Auto-fit: start roomy, step down until the content fits its zone.
  const startScale = layout === 'card' ? 0.82 : layout === 'band' ? 0.86 : 1;
  const available = () => zoneBottom - zoneTop;
  let blocks = build(startScale);
  let cardBox: { y: number; h: number } | undefined;

  if (layout === 'card') {
    // The card sizes itself to the type rather than the type squeezing into a
    // fixed box, so short posts don't get a half-empty panel.
    const cardH = Math.min(
      Math.max(measure(blocks) + CARD_PAD * 2, 360),
      CANVAS - 160,
    );
    const cardY = (CANVAS - cardH) / 2;
    zoneTop = cardY + CARD_PAD;
    zoneBottom = cardY + cardH - CARD_PAD;
    cardBox = { y: cardY, h: cardH };
  }

  for (
    let s = startScale - 0.05;
    measure(blocks) > available() && s >= 0.38;
    s -= 0.05
  ) {
    blocks = build(s);
  }

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    spec.photo ? photoFrame(p, spec.photo, layout!) : surface!.bg,
  ];
  if (cardBox) parts.push(cardPanel(p, cardBox.y, cardBox.h));
  parts.push(stack(blocks, zoneTop, zoneBottom));

  // Pinned footer, only where there's room for one below the design.
  if (!footerInStack && footer && !eyebrowIsBrand && spec.kind !== 'quote') {
    parts.push(
      centered ? footerCentered(footer, p, t) : footerLeft(footer, pad, p, t),
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}
