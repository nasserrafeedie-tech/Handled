import { Jimp } from 'jimp';

import type { PhotoLayout } from './slide-templates';

/**
 * A cheap read of where a photo's subject is, with no model. The subject is
 * taken to be the part of the photo whose colour stands out most from the
 * photo as a whole: a corgi against a dirt path, a latte against a wooden
 * table. Edge density was tried first and failed on real photos, because a
 * background of trees or leaves has more texture than the dog in front of it.
 *
 * Measured on the photo as the slide crops it (centred, 4:5), on a 32×40 grid.
 */
export interface PhotoRead {
  /** Centre of the subject, 0 (top) to 1 (bottom). */
  focusY: number;
  /**
   * How much of the subject falls in the lower band where a card or a
   * full-bleed caption sits (40% to 92% of the height). An even spread puts
   * about half there.
   */
  underWords: number;
}

const GRID_W = 32;
const GRID_H = 40;
/** The share of cells, brightest contrast first, counted as the subject. */
const SUBJECT_SHARE = 0.15;
const WORDS_TOP = 0.4;
const WORDS_BOTTOM = 0.92;

export async function readPhoto(photo: string | Buffer): Promise<PhotoRead | null> {
  try {
    const buf =
      typeof photo === 'string' ? Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64') : photo;
    const img = await Jimp.read(buf);
    const { width: W, height: H } = img.bitmap;
    const tw = Math.min(W, Math.round(H * 0.8));
    const th = Math.min(H, Math.round(W * 1.25));
    img.crop({ x: Math.round((W - tw) / 2), y: Math.round((H - th) / 2), w: tw, h: th });
    img.resize({ w: GRID_W, h: GRID_H });
    const d = img.bitmap.data;
    const n = GRID_W * GRID_H;
    let mr = 0;
    let mg = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) {
      mr += d[i * 4];
      mg += d[i * 4 + 1];
      mb += d[i * 4 + 2];
    }
    mr /= n;
    mg /= n;
    mb /= n;
    const contrast = Array.from({ length: n }, (_, i) =>
      Math.hypot(d[i * 4] - mr, d[i * 4 + 1] - mg, d[i * 4 + 2] - mb),
    );
    // Exactly the top cells, not everything at or above a cutoff: on a flat
    // background every cell ties, and a cutoff would count them all.
    const top = contrast
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v)
      .slice(0, Math.round(n * SUBJECT_SHARE));
    let total = 0;
    let weightedY = 0;
    let under = 0;
    top.forEach(({ v, i }) => {
      if (v <= 0) return;
      const y = Math.floor(i / GRID_W) / (GRID_H - 1);
      total += v;
      weightedY += v * y;
      if (y > WORDS_TOP && y < WORDS_BOTTOM) under += v;
    });
    if (total <= 0) return null; // a flat photo has no subject to protect
    return { focusY: weightedY / total, underWords: under / total };
  } catch {
    return null;
  }
}

/**
 * The review step for a photo slide. 'full' and 'card' put the words over the
 * lower part of the photo. When more of the subject sits there than an even
 * spread would put there (about half), the words would cover it, so the slide moves to
 * 'frame', where the photo has its own inset above the words. Other layouts
 * already keep the words off the photo.
 */
export function reviewPhotoLayout(layout: PhotoLayout, read: PhotoRead | null): PhotoLayout {
  if (!read) return layout;
  if ((layout === 'full' || layout === 'card') && read.underWords > COVERED_ABOVE) return 'frame';
  return layout;
}

/** Above this share of the subject in the words' band, the words would cover it. */
export const COVERED_ABOVE = 0.5;

/** How to align a cropped photo so its subject stays in view. */
export function cropAlign(focusY: number | undefined): 'xMidYMin' | 'xMidYMid' | 'xMidYMax' {
  if (focusY === undefined) return 'xMidYMid';
  if (focusY < 0.38) return 'xMidYMin';
  if (focusY > 0.62) return 'xMidYMax';
  return 'xMidYMid';
}
