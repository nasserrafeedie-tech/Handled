/**
 * Phones send curly quotes by default ("what’s", "I’ll", “yes”). Every reply
 * rule matches straight ones, so "where’s the video" used to miss the reel
 * look and fall through to a guess. The raw text is still what gets logged.
 */
export function plainQuotes(body: string): string {
  return body.replace(/[‘’‚‛ʼ′]/g, "'").replace(/[“”„‟″]/g, '"');
}
