/**
 * Texts for a reel the owner asks about by text: "show me the reel", "make a
 * reel". Kept pure so the wording is tested on its own.
 */

/** What to call a reel post: the animated kinds by name, else just "reel". */
export function reelName(archetype: string | null, r2Key: string): string {
  if (!r2Key.endsWith('animated-reel.mp4')) return 'reel';
  return archetype === 'promo' ? 'promo reel' : 'before and after reel';
}

/**
 * "show me the reel": the watch link again, and where the reel stands. "yes"
 * answers the oldest waiting draft, so it only invites a yes when nothing is
 * ahead of the reel.
 */
export function reelLookText(v: {
  what: string;
  url: string;
  status: string;
  when: string | null;
  waitingAhead: number;
}): string {
  const head = `Here's your ${v.what} 🎬 ${v.url}`;
  if (v.status === 'pending_approval') {
    if (v.waitingAhead <= 0) return `${head}\n\nReply “yes” to schedule it, or tell me what to change.`;
    const ahead = v.waitingAhead === 1 ? 'the draft already waiting on you' : `the ${v.waitingAhead} drafts already waiting on you`;
    return `${head}\n\nIt's waiting for your yes, right after ${ahead}.`;
  }
  if (v.status === 'published') return `${head}\n\nIt's already posted.`;
  if ((v.status === 'scheduled' || v.status === 'approved') && v.when) return `${head}\n\nIt's scheduled for ${v.when}.`;
  return head;
}

/**
 * "make a reel" with no kind named. Off Pro it's the upgrade; on Pro it's
 * where to send clips, plus the two kinds that need no footage when animated
 * reels are on.
 */
export function plainReelText(v: { pro: boolean; uploadUrl: string; animated: boolean; upgrade: string }): string {
  if (!v.pro) return `Reels are part of Pro. ${v.upgrade} Reply UPGRADE and I'll set it up.`;
  const clips = `Send me 3 to 5 short clips, 5 to 10 seconds each, and I'll cut the reel: ${v.uploadUrl}`;
  if (!v.animated) return clips;
  return (
    `${clips}\n\nNo footage? Say "make a promo reel" and name the offer, ` +
    `or text a before photo and an after photo together with "before and after reel".`
  );
}

/** "before and after reel" sent with one photo, or three. */
export const REVEAL_NEEDS_TWO =
  'For a before and after reel I need two photos in one text: the before first, then the after. Send them together with "before and after reel".';
