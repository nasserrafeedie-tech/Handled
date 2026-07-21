/**
 * What a file actually is, decided by reading it rather than by asking.
 *
 * An upload's declared Content-Type is written by whatever posted the request,
 * so it is a claim, not a fact. Trusting it meant two things: a file that is not
 * really an image sailed through and failed later at publish time — after the
 * owner had already approved the post — and the stored filename extension was
 * derived from the same untrusted string, so a caller could choose what we wrote
 * into a bucket we serve.
 *
 * These are the formats a phone actually produces. HEIC and MOV matter as much
 * as JPEG and MP4 here: an iPhone shoots both by default.
 */

export type MediaKind = 'image' | 'video';

export interface DetectedMedia {
  kind: MediaKind;
  /** Canonical content type — what we store and hand to the platform APIs. */
  contentType: string;
  /** Canonical extension, without the dot. Derived here, never from input. */
  ext: string;
}

/** ISO base-media (`ftyp`) brands, which cover MP4, MOV, and HEIC alike. */
const FTYP_BRANDS: Record<string, DetectedMedia> = {
  // HEIC/HEIF — the iPhone photo default.
  heic: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  heix: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  heim: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  heis: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  hevc: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  hevm: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  hevs: { kind: 'image', contentType: 'image/heic', ext: 'heic' },
  mif1: { kind: 'image', contentType: 'image/heif', ext: 'heif' },
  msf1: { kind: 'image', contentType: 'image/heif', ext: 'heif' },
  // QuickTime — the iPhone video default.
  'qt  ': { kind: 'video', contentType: 'video/quicktime', ext: 'mov' },
  // MP4 and friends.
  isom: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  iso2: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  iso4: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  iso5: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  iso6: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  mp41: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  mp42: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  avc1: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  dash: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
  M4V: { kind: 'video', contentType: 'video/mp4', ext: 'mp4' },
};

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length &&
  bytes.every((b, i) => buf[offset + i] === b);

/**
 * Identify an upload from its leading bytes, or null if it isn't a media file
 * we accept. Null means reject — never fall back to the declared type.
 */
export function detectMedia(buf: Buffer): DetectedMedia | null {
  if (!buf || buf.length < 12) return null;

  // JPEG — FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', contentType: 'image/jpeg', ext: 'jpg' };
  }

  // PNG — the 8-byte signature, including the CRLF/EOF trap bytes.
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', contentType: 'image/png', ext: 'png' };
  }

  // GIF — "GIF87a" or "GIF89a"
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { kind: 'image', contentType: 'image/gif', ext: 'gif' };
  }

  // WebP — "RIFF" then a size, then "WEBP"
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { kind: 'image', contentType: 'image/webp', ext: 'webp' };
  }

  // ISO base media: a size, then "ftyp", then a four-character brand. This is
  // the same container shape for MP4, MOV, and HEIC — only the brand differs,
  // which is why the extension cannot be guessed from the header alone.
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    const match = FTYP_BRANDS[brand];
    if (match) return match;
    // An unknown brand is still an ISO media file. Treat it as video/mp4 rather
    // than rejecting an owner's clip over a brand we haven't catalogued.
    return { kind: 'video', contentType: 'video/mp4', ext: 'mp4' };
  }

  return null;
}
