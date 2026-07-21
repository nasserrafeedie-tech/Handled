/**
 * The last pass over a caption, for the tells a prompt cannot reliably fix.
 *
 * Most voice rules belong in the playbook, where the model can act on them.
 * Em-dash frequency is the exception: measured over sampled generations, adding
 * "use at most one em-dash" to the prompt did not reduce the count at all — it
 * went slightly up. Models are poor at counting their own punctuation, so this
 * is enforced here, where counting is free and certain.
 *
 * Two or three em-dashes in a short caption is one of the clearest signals that
 * a machine wrote it.
 */

/** Em-dashes allowed before we start rewriting them. */
const MAX_EM_DASHES = 1;

/**
 * Reduce em-dashes to at most one, keeping the first. Extras become commas.
 *
 * Always a comma, deliberately. An em-dash does two different jobs — it closes
 * a parenthetical aside (`beans — roasted nearby — are warm`) and it joins two
 * standalone clauses — and only the second would ideally become a full stop.
 * Telling those apart from the text alone is unreliable: a word-count heuristic
 * turned "The beans—roasted eight blocks away—are still warm" into a sentence
 * whose subject had been stranded in the previous one. A comma is grammatical
 * in the aside case and merely a splice in the other, so it is the repair that
 * cannot produce a broken sentence.
 */
export function capEmDashes(caption: string): string {
  if (!caption) return caption;
  // Count only true em-dashes; hyphens in "half-price" are not a tell.
  const total = (caption.match(/—/g) ?? []).length;
  if (total <= MAX_EM_DASHES) return caption;

  let seen = 0;
  return caption.replace(/\s*—\s*/g, (match) => {
    seen += 1;
    return seen <= MAX_EM_DASHES ? match : ', ';
  });
}

/**
 * Everything we clean up after generation. Kept as one entry point so callers
 * do not have to know which fixes exist.
 */
export function polishCaption(caption: string): string {
  return capEmDashes(caption);
}
