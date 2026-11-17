/**
 * The two animated reel templates, as functions of time.
 *
 * Each returns the SVG for the frame at `t` seconds. They are pure: the same
 * layout, look and time always give the same string, which is what lets the
 * renderer skip re-drawing the frames where nothing moves. Motion is fixed by
 * the template, so a reel can't come out with words flying off the frame or a
 * beat that never lands: the spec only decides the words.
 *
 *   promo         the offer builds in (kicker, headline, the old price struck
 *                 through, the new one landing), holds, then hands over to the
 *                 end card with the next step. 11.5s.
 *   before_after  the before photo with its caption, a wipe across to the after
 *                 photo, its caption, then the end card rising over it. 11.5s.
 */
import { capHeight } from '../../graphics/text-metrics';
import {
  REEL_H as H,
  REEL_W as W,
  backOut,
  clamp01,
  easeInOut,
  easeOut,
  esc,
  lerp,
  lineWidth,
  mix,
  prog,
  r1,
  r3,
  shown,
  type Face,
} from './kit';
import type { ReelLook } from './look';
import { MARGIN, type AnimatedLayout, type Block, type BeforeAfterLayout, type EndLayout, type PromoLayout } from './spec';

export const DURATION: Record<AnimatedLayout['kind'], number> = { promo: 11.5, before_after: 11.5 };

/** Photos for a reveal, already cropped to the frame (see AnimatedReelService). */
export interface RevealPhotos {
  before: string;
  after: string;
}

/* ── shared drawing ────────────────────────────────────────────────────── */

const lineHeight = (face: Face) => (/anton/i.test(face.family) ? 1.0 : 1.12);

function textLines(
  block: Block,
  face: Face,
  opts: { x: number; top: number; fill: string; anchor?: 'start' | 'middle'; opacity?: number; each?: (i: number) => string },
): string {
  const cap = capHeight(face.family, face.weight);
  const lh = block.size * lineHeight(face);
  return block.lines
    .map((l, i) => {
      const y = opts.top + cap * block.size + i * lh;
      const inner =
        `<text x="${r1(opts.x)}" y="${r1(y)}" font-family="${face.family}" font-weight="${face.weight}" ` +
        `font-size="${block.size}" letter-spacing="${face.tracking}" fill="${opts.fill}"` +
        `${opts.anchor === 'middle' ? ' text-anchor="middle"' : ''}>${esc(shown(l, face))}</text>`;
      return opts.each ? `<g ${opts.each(i)}>${inner}</g>` : inner;
    })
    .join('');
}

const blockHeight = (b: Block, face: Face) =>
  capHeight(face.family, face.weight) * b.size + (b.lines.length - 1) * b.size * lineHeight(face);

const TAG: Face = { family: 'Poppins', weight: 600, tracking: 6, upper: true };
const KICKER: Face = { family: 'Poppins', weight: 600, tracking: 5, upper: true };
const BUTTON: Face = { family: 'Poppins', weight: 700, tracking: 3, upper: true };

/** The end card: brand line, big line, one supporting line, the button. */
function endCard(end: EndLayout, look: ReelLook, t: number, at: number): string {
  const text = easeOut(prog(t, at, 0.7));
  const btn = backOut(prog(t, at + 0.6, 0.6));
  const tagTop = 560;
  const headTop = 700;
  const headH = blockHeight(end.headline, look.head);
  const bodyTop = headTop + headH + 70;
  const bodyH = end.body ? blockHeight(end.body, look.body) + 30 : 0;
  const ruleY = headTop + headH + 40;
  const btnY = bodyTop + bodyH + 150;
  const h = 116;
  return `<g opacity="${r3(text)}" transform="translate(0 ${r1((1 - text) * 90)})">
    ${end.brand ? textLines(end.brand, TAG, { x: W / 2, top: tagTop, fill: look.accent, anchor: 'middle' }) : ''}
    ${textLines(end.headline, look.head, { x: W / 2, top: headTop, fill: look.ink, anchor: 'middle' })}
    <rect x="${W / 2 - 60}" y="${r1(ruleY)}" width="120" height="6" rx="3" fill="${look.accent}"/>
    ${end.body ? textLines(end.body, look.body, { x: W / 2, top: bodyTop, fill: look.soft, anchor: 'middle' }) : ''}
  </g>
  <g transform="translate(${W / 2} ${r1(btnY)}) scale(${r3(Math.max(0, btn))})" opacity="${r3(clamp01(btn))}">
    <rect x="${r1(-end.cta.width / 2)}" y="${-h / 2}" width="${r1(end.cta.width)}" height="${h}" rx="${h / 2}" fill="${look.accent}"/>
    <text x="0" y="${r1(capHeight(BUTTON.family, BUTTON.weight) * end.cta.size / 2)}" text-anchor="middle" font-family="${BUTTON.family}" font-weight="${BUTTON.weight}" font-size="${end.cta.size}" letter-spacing="${BUTTON.tracking}" fill="${look.onAccent}">${esc(shown(end.cta.label, BUTTON))}</text>
  </g>`;
}

const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;

/* ── promo ─────────────────────────────────────────────────────────────── */

/**
 * When each beat of a promo lands. Derived from the layout so a two-line
 * headline doesn't keep the price waiting as long as a three-line one.
 */
export function promoBeats(l: PromoLayout) {
  const headAt = 1.0;
  const headEnd = headAt + 0.3 * l.headline.lines.length + 0.25;
  const wasAt = headEnd + 0.4;
  const priceAt = l.wasPrice ? wasAt + 0.8 : headEnd + 0.4;
  const detailAt = l.price ? priceAt + 1.0 : headEnd + 0.6;
  return { headAt, wasAt, strikeAt: wasAt + 0.45, priceAt, detailAt, outAt: 8.2, endAt: 8.6 };
}

export function promoFrame(l: PromoLayout, look: ReelLook, t: number, seed = 0): string {
  const b = promoBeats(l);
  const out = easeInOut(prog(t, b.outAt, 0.7));

  // The offer block's height, so it sits centred whatever its line count.
  const kickH = blockHeight(l.kicker, KICKER);
  const headH = blockHeight(l.headline, look.head);
  const priceH = l.price ? blockHeight(l.price, look.head) : 0;
  const detH = l.details.reduce((s, d) => s + blockHeight(d, look.body) + 26, 0);
  const total = kickH + 56 + headH + (l.price ? 70 + priceH : 0) + (detH ? 70 + detH : 0);
  const top = Math.max(360, (H - total) / 2 + 40);

  const kickTop = top;
  const headTop = kickTop + kickH + 56;
  const priceTop = headTop + headH + 70;
  const detTop = (l.price ? priceTop + priceH : headTop + headH) + 70;

  const kicker = easeOut(prog(t, 0.7, 0.5));
  const tag = easeOut(prog(t, 0.3, 0.6));
  const was = easeOut(prog(t, b.wasAt, 0.4));
  const strike = easeOut(prog(t, b.strikeAt, 0.35));
  const price = backOut(prog(t, b.priceAt, 0.6));
  const pulse = 1 + 0.025 * Math.sin(Math.max(0, t - b.priceAt - 0.6) * 3.2);
  const glow = 0.2 + 0.08 * Math.sin(t * 2.2);

  const wasW = l.wasPrice ? lineWidth(l.wasPrice.lines[0], look.body, l.wasPrice.size) : 0;
  const priceX = MARGIN + (l.wasPrice ? wasW + 48 : 0);

  const offer = `<g transform="translate(0 ${r1(-out * 520)})" opacity="${r3(1 - out)}">
    <g opacity="${r3(kicker)}" transform="translate(0 ${r1((1 - kicker) * 30)})">
      ${textLines(l.kicker, KICKER, { x: MARGIN, top: kickTop, fill: look.accent })}
    </g>
    ${textLines(l.headline, look.head, {
      x: MARGIN,
      top: headTop,
      fill: look.ink,
      each: (i) => {
        const p = backOut(prog(t, b.headAt + i * 0.3, 0.55));
        const y = headTop + i * l.headline.size * lineHeight(look.head);
        return `opacity="${r3(clamp01(p))}" transform="translate(${MARGIN} ${r1(y)}) scale(${r3(lerp(1.22, 1, clamp01(p)))}) translate(${-MARGIN} ${r1(-y)})"`;
      },
    })}
    ${l.wasPrice ? `<g opacity="${r3(was)}">
      ${textLines(l.wasPrice, look.body, { x: MARGIN, top: priceTop + priceH - blockHeight(l.wasPrice, look.body) - 10, fill: look.soft })}
      <rect x="${MARGIN - 6}" y="${r1(priceTop + priceH - blockHeight(l.wasPrice, look.body) / 2 - 12)}" width="${r1((wasW + 12) * strike)}" height="7" fill="${look.accent}"/>
    </g>` : ''}
    ${l.price ? `<g transform="translate(${r1(priceX)} ${r1(priceTop + priceH)}) scale(${r3(Math.max(0, lerp(0.4, 1, price) * pulse))}) translate(${r1(-priceX)} ${r1(-(priceTop + priceH))})" opacity="${r3(clamp01(price))}">
      ${textLines(l.price, look.head, { x: priceX, top: priceTop, fill: look.accent })}
    </g>` : ''}
    ${(() => {
      let y = detTop;
      return l.details
        .map((d, i) => {
          const p = easeOut(prog(t, b.detailAt + i * 0.4, 0.5));
          const s = `<g opacity="${r3(p)}" transform="translate(0 ${r1((1 - p) * 24)})">${textLines(d, look.body, { x: MARGIN, top: y, fill: i === 0 ? look.ink : look.soft })}</g>`;
          y += blockHeight(d, look.body) + 26;
          return s;
        })
        .join('');
    })()}
  </g>`;

  return `${svgOpen}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${look.bg}"/><stop offset="1" stop-color="${look.bgDeep}"/></linearGradient>
    <radialGradient id="glow" cx="0.15" cy="0.88" r="0.65"><stop offset="0" stop-color="${look.accent}" stop-opacity="${r3(glow)}"/><stop offset="1" stop-color="${look.accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${decor(look, t, seed)}
  ${l.end.brand ? `<g opacity="${r3(tag * (1 - out))}">${textLines(l.end.brand, TAG, { x: MARGIN, top: 200, fill: look.accent })}</g>` : ''}
  ${offer}
  ${endCard(l.end, look, t, b.endAt)}
</svg>`;
}

/**
 * The moving shapes behind a promo. Two sets, picked by the brand's seed, so
 * two shops on Pro don't open on the identical stripes.
 */
function decor(look: ReelLook, t: number, seed: number): string {
  const sIn = easeOut(prog(t, 0, 1.0));
  if (seed % 2 === 0) {
    const drift = (t * 18) % 46;
    return [0, 1, 2, 3]
      .map(
        (k) =>
          `<rect x="${r1(760 + k * 46 - (1 - sIn) * 520 + drift)}" y="-200" width="18" height="900" fill="${look.accent}" opacity="${r3(0.16 - k * 0.03)}" transform="rotate(35 900 200)"/>`,
      )
      .join('');
  }
  const ring = (cx: number, cy: number, rr: number, k: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r1(rr * lerp(0.6, 1, sIn) + Math.sin(t * 1.4 + k) * 8)}" fill="none" stroke="${look.accent}" stroke-width="${10 - k * 2}" opacity="${r3((0.18 - k * 0.04) * sIn)}"/>`;
  return ring(930, 260, 180, 0) + ring(930, 260, 270, 1) + ring(930, 260, 360, 2);
}

/* ── before and after ──────────────────────────────────────────────────── */

export const REVEAL = { wipeAt: 3.6, wipeDur: 1.3, endAt: 8.5 } as const;

/*
 * The photo motion of a reveal, written twice: once as JS (for the SVG frame)
 * and once as an ffmpeg expression (the renderer lets ffmpeg move the photos,
 * which is many times faster than drawing a photo per frame in resvg). The
 * spec checks that the two agree, so the curve is defined right here, once.
 */
const PUSH_IN = 0.05; // the before photo creeps in by 5% until the wipe ends
const SETTLE = { from: 1.06, dur: 4.5 }; // the after photo settles from 106%

/** 0 → 1 across the frame: how far the wipe has gone at `t`. */
export const wipeAt = (t: number): number => easeInOut(prog(t, REVEAL.wipeAt, REVEAL.wipeDur));
export const beforeZoom = (t: number): number => 1 + PUSH_IN * prog(t, 0, REVEAL.wipeAt + REVEAL.wipeDur);
export const afterZoom = (t: number): number =>
  SETTLE.from - (SETTLE.from - 1) * easeOut(prog(t, REVEAL.wipeAt, SETTLE.dur));

/** The same three curves for ffmpeg, in its expression language (`t` in seconds). */
export function revealExpressions(): { wipe: string; beforeZoom: string; afterZoom: string } {
  const p = (at: number, dur: number) => `clip((t-${at})/${dur},0,1)`;
  const wp = p(REVEAL.wipeAt, REVEAL.wipeDur);
  const sp = p(REVEAL.wipeAt, SETTLE.dur);
  return {
    wipe: `if(lt(${wp},0.5),4*pow(${wp},3),1-pow(-2*${wp}+2,3)/2)`,
    beforeZoom: `(1+${PUSH_IN}*${p(0, REVEAL.wipeAt + REVEAL.wipeDur)})`,
    afterZoom: `(${SETTLE.from}-${r3(SETTLE.from - 1)}*(1-pow(1-${sp},3)))`,
  };
}

/**
 * One frame of the reveal. With `photos` null it draws everything but the
 * photos, on a clear background: the overlay the renderer lays over the photo
 * layer that ffmpeg moves.
 */
export function beforeAfterFrame(l: BeforeAfterLayout, look: ReelLook, photos: RevealPhotos | null, t: number): string {
  const wipe = wipeAt(t);
  const x = wipe * W;
  const end = easeInOut(prog(t, REVEAL.endAt, 0.9));
  const zb = beforeZoom(t);
  const za = afterZoom(t);
  // Photos are the expensive part of a frame, so draw only what shows.
  const showBefore = !!photos && wipe < 1 && end < 1;
  const showAfter = !!photos && wipe > 0 && end < 1;
  const img = (href: string, z: number) => {
    const w = W * 1.08 * z;
    const h = H * 1.08 * z;
    return `<image href="${href}" x="${r1((W - w) / 2)}" y="${r1((H - h) / 2)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="xMidYMid slice"/>`;
  };
  const cap1 = easeOut(prog(t, 0.6, 0.6)) * (1 - easeOut(prog(t, REVEAL.wipeAt - 0.3, 0.4)));
  const cap2 = easeOut(prog(t, REVEAL.wipeAt + REVEAL.wipeDur + 0.3, 0.6)) * (1 - easeOut(prog(t, REVEAL.endAt - 0.2, 0.4)));
  const caption = (b: Block, o: number) =>
    o <= 0
      ? ''
      : `<g opacity="${r3(o)}" transform="translate(0 ${r1((1 - o) * 20)})">${textLines(b, look.head, { x: W / 2, top: 280, fill: '#FFFFFF', anchor: 'middle' })}</g>`;
  const pill = (label: string, o: number) => {
    if (o <= 0) return '';
    const w = label.length * 26 + 84;
    return `<g opacity="${r3(o)}"><rect x="72" y="150" width="${w}" height="70" rx="35" fill="${look.bg}" opacity="0.9"/>
      <circle cx="108" cy="185" r="9" fill="${look.accent}"/>
      <text x="132" y="197" font-family="Poppins" font-weight="600" font-size="30" letter-spacing="5" fill="${look.ink}">${label}</text></g>`;
  };
  return `${svgOpen}
  <defs>
    <clipPath id="rev"><rect x="0" y="0" width="${r1(x)}" height="${H}"/></clipPath>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0.62"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></linearGradient>
  </defs>
  ${photos ? `<rect width="${W}" height="${H}" fill="${look.bgDeep}"/>` : ''}
  ${showBefore ? img(photos!.before, zb) : ''}
  ${showAfter ? `<g clip-path="url(#rev)">${img(photos!.after, za)}</g>` : ''}
  ${wipe > 0 && wipe < 1 ? `<rect x="${r1(x - 4)}" y="0" width="8" height="${H}" fill="${look.accent}"/><circle cx="${r1(x)}" cy="${H / 2}" r="34" fill="${look.accent}"/>` : ''}
  ${end < 1 ? `<rect width="${W}" height="640" fill="url(#scrim)"/>` : ''}
  ${pill('BEFORE', 1 - clamp01(wipe * 2))}${pill('AFTER', clamp01(wipe * 2 - 1) * (1 - end))}
  ${caption(l.before, cap1)}
  ${caption(l.after, cap2)}
  ${end > 0 ? `<g transform="translate(0 ${r1((1 - end) * H)})">
    <rect width="${W}" height="${H}" fill="${look.bg}"/>
    <rect width="${W}" height="${H}" fill="${mix(look.bg, look.bgDeep, 0.5)}" opacity="0.5"/>
  </g>` : ''}
  ${end > 0 ? endCard(l.end, look, t, REVEAL.endAt + 0.5) : ''}
</svg>`;
}

export function frameAt(
  layout: AnimatedLayout,
  look: ReelLook,
  t: number,
  opts: { photos?: RevealPhotos | null; seed?: number } = {},
): string {
  if (layout.kind === 'promo') return promoFrame(layout, look, t, opts.seed ?? 0);
  // null asks for the overlay alone (see beforeAfterFrame); undefined is a mistake.
  if (opts.photos === undefined) throw new Error('a before-and-after reel needs both photos');
  return beforeAfterFrame(layout, look, opts.photos, t);
}
