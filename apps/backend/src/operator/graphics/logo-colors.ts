/**
 * Pull a business's brand colors out of its logo.
 *
 * The naive version — "the most common color" — returns WHITE, because most
 * logos are one brand mark on a white (or black) field. So the real work is
 * throwing away the background and the ink: near-white, near-black, and the
 * greys of anti-aliased edges and text. What's left is the actual brand colour,
 * clustered by hue so a two-tone logo yields a primary and a secondary.
 *
 * A confidence gate matters as much as the extraction: a black-and-white logo,
 * or a photographic one, should return NOTHING and let the caller fall back to
 * the owner's words or the per-brand default — never a colour we invented from
 * anti-aliasing noise.
 */
import { Jimp } from 'jimp';

export interface LogoColors {
  primary?: string;
  secondary?: string;
  /** The logo's real pixel dimensions, so the caller can judge its quality. */
  width?: number;
  height?: number;
}

/**
 * The smallest a logo's longer side may be to composite it onto a slide. Below
 * this we still take its COLOURS (which survive any resolution) but do NOT stamp
 * the logo, because scaling a tiny mark up into the badge box looks blurry — and
 * a clean text name beats a fuzzy logo on every post. Instagram carousels render
 * near 1080px, often on 2× screens; a logo under this reads soft in the badge.
 */
export const MIN_LOGO_SIDE = 180;

/** Wrap stored logo bytes as a data URI for compositing into an SVG slide. */
export function logoDataUri(bytes: Buffer, ext: string): string {
  const e = ext.toLowerCase();
  const mime =
    e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Extract up to two brand colors from a logo's bytes. Returns {} when the image
 * has no confident brand colour (monochrome, greyscale, unreadable) — that is a
 * valid, expected answer, not a failure.
 */
export async function extractBrandColors(buffer: Buffer): Promise<LogoColors> {
  let img;
  try {
    img = await Jimp.read(buffer);
  } catch {
    // Not a decodable raster (corrupt, or an SVG/PDF we can't read as pixels).
    return {};
  }
  // Capture the REAL dimensions before downscaling mutates them — the caller
  // uses them to decide whether the logo is sharp enough to composite.
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  // Downscale for speed; colour survives it. Keep aspect so we don't skew hues.
  img.scaleToFit({ w: 96, h: 96 });
  const d = img.bitmap.data; // RGBA

  const BUCKET_DEG = 15; // 24 hue buckets
  const buckets = new Map<number, Bucket>();
  let sampled = 0;
  let kept = 0;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const a = d[i + 3];
    sampled++;
    if (a < 128) continue; // transparent — the logo's cut-out background
    const [h, s, l] = rgbToHsl(r, g, b);
    // The whole trick: drop the background and the ink. Near-white and
    // near-black are the field and the type; low saturation is grey (edges,
    // shadows, monochrome marks). Only a genuinely coloured pixel survives.
    if (l > 0.92 || l < 0.08 || s < 0.18) continue;
    kept++;
    const key = Math.floor(h / BUCKET_DEG);
    const acc = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    acc.count++;
    acc.r += r;
    acc.g += g;
    acc.b += b;
    buckets.set(key, acc);
  }

  // Confidence gate: too few coloured pixels means there is no brand colour to
  // find. Better to say nothing and fall back than to report noise.
  if (buckets.size === 0 || kept < sampled * 0.02) return { width, height };

  const ranked = [...buckets.values()].sort((x, y) => y.count - x.count);
  const rep = (acc: Bucket) =>
    toHex(acc.r / acc.count, acc.g / acc.count, acc.b / acc.count);

  const primary = rep(ranked[0]);
  // A secondary only when a second hue has real support — not a sliver, which
  // would just be a gradient edge of the primary.
  const secondary =
    ranked[1] && ranked[1].count >= ranked[0].count * 0.25
      ? rep(ranked[1])
      : undefined;

  return { primary, secondary, width, height };
}
