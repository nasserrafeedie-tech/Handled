/**
 * The brand's look, translated to a vertical reel.
 *
 * Same inputs as the carousels (colours, type style, name), so an animated
 * reel reads as the same brand as the rest of the feed. Every colour pair the
 * templates draw is checked for contrast here, once, instead of trusting that
 * a brand's two colours happen to work together: a pale accent on a pale
 * surface is the classic way a promo becomes unreadable.
 */
import { typeSet, type BrandTheme } from '../../graphics/slide-templates';
import { contrast, mix, toHex, type Face } from './kit';

const WHITE = '#FFFFFF';
const DARK = '#15120E';

export interface ReelLook {
  /** Main surface. */
  bg: string;
  /** The deep end of the surface's gradient. */
  bgDeep: string;
  /** Words on the surface. */
  ink: string;
  /** Supporting words on the surface (dates, small print). */
  soft: string;
  /** The brand's second colour where it reads on the surface; the price, the button. */
  accent: string;
  /** Words on the accent (the button label). */
  onAccent: string;
  head: Face;
  body: Face;
  /** The business name as the reel prints it, or undefined. */
  brandName?: string;
}

const best = (bg: string): string => (contrast(bg, WHITE) >= contrast(bg, DARK) ? WHITE : DARK);

export function reelLook(theme: BrandTheme): ReelLook {
  let bg = toHex(theme.primary, '#2C3E50');
  // A mid-tone brand colour can fail with both white and near-black type.
  // Deepen it until white reads: the brand still shows, the words still read.
  for (let i = 0; i < 4 && Math.max(contrast(bg, WHITE), contrast(bg, DARK)) < 4.5; i++) {
    bg = mix(bg, '#000000', 0.2);
  }
  const ink = best(bg);
  const darkSurface = ink === WHITE;
  const bgDeep = mix(bg, darkSurface ? '#000000' : DARK, darkSurface ? 0.35 : 0.08);
  const soft = mix(ink, bg, 0.28);

  // The accent is the brand's second colour when it stands out from the
  // surface; otherwise a tint of the main colour that does; otherwise the ink.
  const candidates = [
    theme.secondary ? toHex(theme.secondary, '') : '',
    mix(bg, darkSurface ? WHITE : '#000000', 0.55),
    ink,
  ].filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const accent = candidates.find((c) => contrast(c, bg) >= 2.6) ?? ink;
  const onAccent = best(accent);

  const t = typeSet(theme.style);
  return {
    bg,
    bgDeep,
    ink,
    soft,
    accent,
    onAccent,
    head: { family: t.head, weight: t.headWeight, tracking: t.headTracking, upper: t.headUpper },
    body: { family: t.body, weight: 500, tracking: 0, upper: false },
    brandName: theme.brandName?.trim() || undefined,
  };
}
