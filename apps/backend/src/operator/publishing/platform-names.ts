import type { Platform } from '@smm/contracts';

/**
 * How owners refer to these, not how the APIs spell them.
 *
 * "x" and "gmb" are identifiers; nobody says them out loud. Anything shown to
 * an owner goes through here so a failure message reads like a person wrote it.
 */
const NAMES: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  x: 'X',
};

export function platformName(platform: Platform | string): string {
  return NAMES[platform as Platform] ?? String(platform);
}
