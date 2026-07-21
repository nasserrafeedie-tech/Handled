import type { Platform } from '@smm/contracts';

/**
 * What each platform will actually accept.
 *
 * These are the limits the platforms enforce on their side. Nothing checked
 * them before, so a post that broke one was created, shown to the owner,
 * approved, scheduled — and then failed at publish. The owner sees a post that
 * simply never went out, and the failure surfaces hours after the decision that
 * caused it.
 *
 * Checking at draft time turns that into a caption we shorten before anyone
 * reads it. The numbers come from the platforms' published limits; where two
 * platforms disagree the stricter one wins, because a post is drafted before we
 * always know where it will land.
 */

export interface PlatformLimits {
  /** Hard cap on caption characters, hashtags included. */
  captionChars: number;
  /** Allowed width/height range, as ratios. Null where the platform is lax. */
  aspect: { min: number; max: number } | null;
  /** Max images in one carousel. 1 means carousels aren't supported. */
  maxMedia: number;
  /** Max bytes for a single image. */
  maxImageBytes: number;
}

const MB = 1024 * 1024;

/** Instagram's feed window: 4:5 portrait through 1.91:1 landscape. */
const IG_ASPECT = { min: 4 / 5, max: 1.91 };

export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  instagram: {
    captionChars: 2200,
    aspect: IG_ASPECT,
    maxMedia: 10,
    maxImageBytes: 8 * MB,
  },
  facebook: {
    captionChars: 63206,
    aspect: null,
    maxMedia: 10,
    // Facebook rejects photos over 4MB outright.
    maxImageBytes: 4 * MB,
  },
  threads: {
    captionChars: 500,
    aspect: IG_ASPECT,
    maxMedia: 10,
    maxImageBytes: 8 * MB,
  },
  tiktok: {
    captionChars: 2200,
    aspect: null,
    maxMedia: 35,
    maxImageBytes: 20 * MB,
  },
  x: {
    captionChars: 280,
    aspect: null,
    maxMedia: 4,
    maxImageBytes: 5 * MB,
  },
  linkedin: {
    captionChars: 3000,
    aspect: null,
    maxMedia: 9,
    maxImageBytes: 10 * MB,
  },
  youtube: {
    // The description field; titles are handled separately.
    captionChars: 5000,
    aspect: null,
    maxMedia: 1,
    maxImageBytes: 2 * MB,
  },
};

export interface MediaFacts {
  bytes?: number;
  width?: number;
  height?: number;
}

export interface Violation {
  /** Machine-readable, for metrics and tests. */
  code: 'caption_too_long' | 'too_many_media' | 'aspect_out_of_range' | 'image_too_large';
  /** Plain-English, safe to show an owner or log. */
  message: string;
  /** True when we can fix it ourselves without asking. */
  autoFixable: boolean;
}

/**
 * Check a draft against the platform it's headed for.
 *
 * Media facts are optional: we often know the caption long before the image
 * exists, and a partial check that runs early beats a complete one that runs
 * too late. Anything we can't measure is simply not checked.
 */
export function validateForPlatform(
  platform: Platform,
  caption: string,
  media: MediaFacts[] = [],
): Violation[] {
  const limits = PLATFORM_LIMITS[platform];
  if (!limits) return [];
  const out: Violation[] = [];

  if (caption.length > limits.captionChars) {
    out.push({
      code: 'caption_too_long',
      message: `Caption is ${caption.length} characters; ${platform} allows ${limits.captionChars}.`,
      autoFixable: true,
    });
  }

  if (media.length > limits.maxMedia) {
    out.push({
      code: 'too_many_media',
      message: `${media.length} attachments; ${platform} allows ${limits.maxMedia}.`,
      autoFixable: true,
    });
  }

  media.forEach((m, i) => {
    const label = media.length > 1 ? `Image ${i + 1}` : 'The image';

    if (limits.aspect && m.width && m.height) {
      const ratio = m.width / m.height;
      // Round for the message only — compare on the exact value.
      if (ratio < limits.aspect.min || ratio > limits.aspect.max) {
        out.push({
          code: 'aspect_out_of_range',
          message:
            `${label} is ${m.width}x${m.height} (${ratio.toFixed(2)}:1); ` +
            `${platform} needs between ${limits.aspect.min.toFixed(2)}:1 and ${limits.aspect.max}:1.`,
          // Cropping decides what to cut out of someone's photo. That is a
          // judgement about their business, not a formatting fix.
          autoFixable: false,
        });
      }
    }

    if (m.bytes && m.bytes > limits.maxImageBytes) {
      out.push({
        code: 'image_too_large',
        message:
          `${label} is ${(m.bytes / MB).toFixed(1)}MB; ` +
          `${platform} allows ${(limits.maxImageBytes / MB).toFixed(0)}MB.`,
        autoFixable: true,
      });
    }
  });

  return out;
}

/**
 * Trim a caption to fit, breaking at a word rather than mid-word.
 *
 * `budget` overrides the platform limit, for when the caption is only part of
 * what gets published — hashtags share the same field and have to fit too.
 */
export function truncateCaption(
  caption: string,
  platform: Platform,
  budget?: number,
): string {
  const max = budget ?? PLATFORM_LIMITS[platform]?.captionChars;
  if (!max || max <= 0 || caption.length <= max) return caption;
  const cut = caption.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break at a word if one is reasonably near the end; otherwise a caption
  // with no spaces would collapse to almost nothing.
  return (lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}
