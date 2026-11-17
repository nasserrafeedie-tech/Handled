/**
 * Animated reels are new, so they ship dark: nothing makes one unless
 * ANIMATED_REELS=1 is set on the service. Pro only even then (tierHas 'reel').
 */
export function animatedReelsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ANIMATED_REELS === '1';
}
