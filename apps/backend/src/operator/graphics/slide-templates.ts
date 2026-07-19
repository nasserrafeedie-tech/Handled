/**
 * Slide templates → SVG. We compose the design ourselves so the text is always
 * crisp and correctly spelled (unlike diffusion image models), but the result
 * still looks professionally designed: gradient backgrounds, decorative shapes,
 * premium type (Poppins + Playfair Display), badges and dividers.
 *
 * Output is an SVG string that GraphicsService rasterizes to PNG on an
 * Instagram square canvas.
 */

export const CANVAS = 1080;

export type SlideKind = 'title' | 'body' | 'quote' | 'promo' | 'cta';

export interface BrandTheme {
  /** Primary brand color, e.g. "#0F172A". Drives the background gradient. */
  primary: string;
  /** Secondary accent (badges, dividers). Derived from primary if omitted. */
  secondary?: string;
  /** Main text color. Defaults to auto contrast against the background. */
  text?: string;
  /** Business name shown in the footer. */
  brandName?: string;
}

export interface SlideSpec {
  kind: SlideKind;
  headline: string;
  body?: string;
  footer?: string;
}

/* ── fonts ─────────────────────────────────────────────────────────────── */
const SANS = 'Poppins';
const SERIF = "'Playfair Display'";

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

/* ── shared building blocks ────────────────────────────────────────────── */
interface Palette {
  bgTop: string;
  bgBottom: string;
  fg: string;
  fgSoft: string; // muted foreground for body copy
  accent: string;
  onAccent: string;
  deco: string; // decorative shape color (as fg with low opacity)
}

function palette(theme: BrandTheme): Palette {
  const primary = /^#?[0-9a-f]{6}$/i.test(theme.primary || '') ? theme.primary : '#0F172A';
  const dark = luminance(primary) > 0.55;
  const bgTop = dark ? lighten(primary, 0.08) : lighten(primary, 0.06);
  const bgBottom = dark ? darken(primary, 0.18) : darken(primary, 0.34);
  const fg = theme.text || contrastText(bgBottom);
  const accent =
    theme.secondary && /^#?[0-9a-f]{6}$/i.test(theme.secondary)
      ? theme.secondary
      : dark
        ? darken(primary, 0.4)
        : lighten(primary, 0.42);
  return {
    bgTop,
    bgBottom,
    fg,
    fgSoft: fg === '#FFFFFF' ? 'rgba(255,255,255,0.82)' : 'rgba(26,23,18,0.72)',
    accent,
    onAccent: contrastText(accent),
    deco: fg === '#FFFFFF' ? 'rgba(255,255,255,1)' : 'rgba(26,23,18,1)',
  };
}

/** <defs> + gradient background + tasteful decorative shapes. */
function frame(p: Palette): string {
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${p.bgTop}"/>
        <stop offset="1" stop-color="${p.bgBottom}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${p.accent}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
    <circle cx="${CANVAS - 120}" cy="140" r="420" fill="url(#glow)"/>
    <circle cx="${CANVAS - 60}" cy="60" r="230" fill="${p.deco}" opacity="0.06"/>
    <circle cx="120" cy="${CANVAS - 90}" r="170" fill="none" stroke="${p.deco}" stroke-opacity="0.08" stroke-width="2"/>
  `;
}

/** A rounded "pill" badge, horizontally centered on cx. */
function pill(cx: number, cy: number, text: string, p: Palette): string {
  const fs = 30;
  const w = Math.round(text.length * fs * 0.66) + 72;
  const h = 62;
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${p.accent}"/>
    <text x="${cx}" y="${cy + fs * 0.35}" text-anchor="middle" font-family="${SANS}" font-size="${fs}" font-weight="600" letter-spacing="2" fill="${p.onAccent}">${esc(text.toUpperCase())}</text>
  `;
}

/** Centered brand footer with a small accent dot. */
function footerCentered(text: string, p: Palette): string {
  if (!text) return '';
  const fs = 32;
  const y = CANVAS - 92;
  return `
    <g>
      <circle cx="${CANVAS / 2 - text.length * fs * 0.31 - 20}" cy="${y - fs * 0.32}" r="8" fill="${p.accent}"/>
      <text x="${CANVAS / 2 + 8}" y="${y}" text-anchor="middle" font-family="${SANS}" font-size="${fs}" font-weight="600" letter-spacing="1" fill="${p.fg}">${esc(text)}</text>
    </g>
  `;
}

/** Left-aligned brand footer with a small accent square to the left. */
function footerLeft(text: string, x: number, p: Palette): string {
  if (!text) return '';
  const fs = 32;
  const y = CANVAS - 92;
  return `
    <rect x="${x}" y="${y - fs * 0.66}" width="16" height="16" rx="4" fill="${p.accent}"/>
    <text x="${x + 36}" y="${y}" font-family="${SANS}" font-size="${fs}" font-weight="600" letter-spacing="1" fill="${p.fg}">${esc(text)}</text>
  `;
}

/** A pill-shaped call-to-action button with a cleanly drawn arrow. */
function ctaButton(cx: number, cy: number, label: string, p: Palette): string {
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
    <text x="${textCx}" y="${cy + fs * 0.35}" text-anchor="middle" font-family="${SANS}" font-size="${fs}" font-weight="600" letter-spacing="2" fill="${p.onAccent}">${esc(upper)}</text>
    <line x1="${ax - 16}" y1="${cy}" x2="${ax + 16}" y2="${cy}" stroke="${p.onAccent}" stroke-width="5" stroke-linecap="round"/>
    <path d="M ${ax} ${cy - 11} L ${ax + 17} ${cy} L ${ax} ${cy + 11}" fill="none" stroke="${p.onAccent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

/* ── main entry ────────────────────────────────────────────────────────── */
export function renderSlideSvg(spec: SlideSpec, theme: BrandTheme): string {
  const p = palette(theme);
  const pad = 110;
  const maxW = CANVAS - pad * 2;
  const cx = CANVAS / 2;
  const footer = spec.footer ?? theme.brandName ?? '';

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    frame(p),
  ];

  if (spec.kind === 'quote') {
    // Elegant serif quote, big decorative quotation mark, centered.
    parts.push(
      `<text x="${cx}" y="330" text-anchor="middle" font-family="${SERIF}" font-size="360" font-weight="700" fill="${p.accent}" opacity="0.35">&#8220;</text>`,
    );
    const qFs = 78;
    const qLines = wrap(spec.headline, qFs, maxW, 0.5);
    const startY = 560 - ((qLines.length - 1) * qFs * 1.28) / 2;
    parts.push(
      `<text text-anchor="middle" font-family="${SERIF}" font-size="${qFs}" font-style="italic" font-weight="500" fill="${p.fg}" xml:space="preserve">${tspansCentered(qLines, cx, startY, qFs * 1.28)}</text>`,
    );
    // divider
    parts.push(
      `<rect x="${cx - 60}" y="${startY + (qLines.length - 1) * qFs * 1.28 + 70}" width="120" height="5" rx="2.5" fill="${p.accent}"/>`,
    );
    if (footer) {
      parts.push(
        `<text x="${cx}" y="${startY + (qLines.length - 1) * qFs * 1.28 + 160}" text-anchor="middle" font-family="${SANS}" font-size="34" font-weight="600" letter-spacing="1" fill="${p.fgSoft}">${esc(footer)}</text>`,
      );
    }
  } else if (spec.kind === 'promo') {
    // Poster-style offer: badge, huge headline, supporting line, footer.
    parts.push(pill(cx, 250, 'Special Offer', p));
    const short = spec.headline.replace(/\s+/g, '').length <= 8;
    const hFs = short ? 200 : 128;
    const hLines = wrap(spec.headline, hFs, maxW, 0.6);
    const hLH = hFs * 1.02;
    const blockH = hLines.length * hLH;
    const centerY = spec.body ? 540 : 580;
    const startY = centerY - blockH / 2 + hFs * 0.34;
    parts.push(
      `<text text-anchor="middle" font-family="${SANS}" font-size="${hFs}" font-weight="800" fill="${p.fg}" xml:space="preserve">${tspansCentered(hLines, cx, startY, hLH)}</text>`,
    );
    if (spec.body) {
      const bFs = 48;
      const bLines = wrap(spec.body, bFs, maxW, 0.54);
      const bStart = centerY + blockH / 2 + 60;
      parts.push(
        `<text text-anchor="middle" font-family="${SANS}" font-size="${bFs}" font-weight="500" fill="${p.fgSoft}" xml:space="preserve">${tspansCentered(bLines, cx, bStart, bFs * 1.3)}</text>`,
      );
    }
    parts.push(footerCentered(footer, p));
  } else if (spec.kind === 'cta') {
    // Centered call-to-action with a "button" pill.
    const hFs = 88;
    const hLines = wrap(spec.headline, hFs, maxW, 0.58);
    const hLH = hFs * 1.08;
    const startY = 420 - ((hLines.length - 1) * hLH) / 2;
    parts.push(
      `<text text-anchor="middle" font-family="${SANS}" font-size="${hFs}" font-weight="700" fill="${p.fg}" xml:space="preserve">${tspansCentered(hLines, cx, startY, hLH)}</text>`,
    );
    if (spec.body) {
      const bFs = 46;
      const bLines = wrap(spec.body, bFs, maxW, 0.54);
      const bStart = startY + (hLines.length - 1) * hLH + 120;
      parts.push(
        `<text text-anchor="middle" font-family="${SANS}" font-size="${bFs}" font-weight="400" fill="${p.fgSoft}" xml:space="preserve">${tspansCentered(bLines, cx, bStart, bFs * 1.3)}</text>`,
      );
    }
    parts.push(ctaButton(cx, 800, 'Visit us', p));
    parts.push(footerCentered(footer, p));
  } else {
    // title / body — editorial left-aligned with eyebrow + underline.
    const eyebrow = (theme.brandName || footer || 'New').toUpperCase();
    parts.push(
      `<text x="${pad}" y="230" font-family="${SANS}" font-size="30" font-weight="600" letter-spacing="4" fill="${p.accent}">${esc(eyebrow)}</text>`,
    );
    const hFs = spec.kind === 'title' ? 108 : 84;
    const hLines = wrap(spec.headline, hFs, maxW, 0.58);
    const hLH = hFs * 1.06;
    const startY = 340;
    parts.push(
      `<text x="${pad}" font-family="${SANS}" font-size="${hFs}" font-weight="700" fill="${p.fg}" xml:space="preserve">${tspansLeft(hLines, pad, startY, hLH)}</text>`,
    );
    const afterH = startY + (hLines.length - 1) * hLH;
    parts.push(`<rect x="${pad}" y="${afterH + 46}" width="140" height="7" rx="3.5" fill="${p.accent}"/>`);
    if (spec.body) {
      const bFs = 46;
      const bLines = wrap(spec.body, bFs, maxW, 0.54);
      parts.push(
        `<text x="${pad}" font-family="${SANS}" font-size="${bFs}" font-weight="400" fill="${p.fgSoft}" xml:space="preserve">${tspansLeft(bLines, pad, afterH + 140, bFs * 1.35)}</text>`,
      );
    }
    parts.push(footerLeft(footer, pad, p));
  }

  parts.push(`</svg>`);
  return parts.join('');
}
