/**
 * The "your reel is ready" text. "yes" answers the draft the owner was shown
 * last, so a reel they asked for is shown now and takes the yes, with the
 * older drafts coming back after it. A weekly reel nobody asked for waits its
 * turn instead, and says where it sits.
 */
export function reelReadyText(what: string, url: string, waitingAhead: number, ownerAsked = false): string {
  const head = `Your ${what} is ready 🎬 Watch it here: ${url}`;
  const ask = `${head}\n\nReply “yes” to schedule it, or tell me what to change.`;
  if (waitingAhead <= 0) return ask;
  if (ownerAsked) {
    const rest = waitingAhead === 1 ? 'Your other draft is' : `Your other ${waitingAhead} drafts are`;
    return `${ask} ${rest} still waiting, and I'll bring ${waitingAhead === 1 ? 'it' : 'them'} back after.`;
  }
  const ahead = waitingAhead === 1 ? 'the draft already waiting on you' : `the ${waitingAhead} drafts already waiting on you`;
  return `${head}\n\nIt's a post now, and I'll bring it back for your yes right after ${ahead}.`;
}
