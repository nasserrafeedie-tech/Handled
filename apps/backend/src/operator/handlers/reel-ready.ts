/**
 * The "your reel is ready" text. A reel jumps the queue: it arrives while
 * older drafts may still be waiting, and "yes" always answers the oldest
 * waiting draft. So "reply yes to schedule it" is only true when nothing is
 * ahead of it; otherwise say where it sits, the way a requested graphic does
 * (QA, Nov 17: "yes" after a reel scheduled a different post).
 */
export function reelReadyText(what: string, url: string, waitingAhead: number): string {
  const head = `Your ${what} is ready 🎬 Watch it here: ${url}`;
  if (waitingAhead <= 0) return `${head}\n\nReply “yes” to schedule it, or tell me what to change.`;
  const ahead = waitingAhead === 1 ? 'the draft already waiting on you' : `the ${waitingAhead} drafts already waiting on you`;
  return `${head}\n\nIt's a post now, and I'll bring it back for your yes right after ${ahead}.`;
}
