import type { BrandProfile } from '@prisma/client';

/**
 * Render a brand_profile into the stable system context that is cached on every
 * LLM call for this customer (§2, §12). Because it's identical call-to-call, the
 * prompt cache makes effective input ~10x cheaper. Keep the ordering stable —
 * reordering busts the cache.
 */
export function buildBrandContext(p: BrandProfile): string {
  const lines: string[] = [
    'You write social media content for a specific small business.',
    'Match its voice exactly. Never invent facts, offers, or claims.',
    '',
    // The two roles are labelled and separated on purpose. Listed as bare
    // "Business type" and "Target customer" lines, a model reads the audience
    // as the subject and writes from inside their world. Harmless when a café's
    // customers are its neighbours; wrong when the customers ARE other trades —
    // a service whose clients are salons produced hair-washing tips and "how we
    // organise a chair between clients", none of which it does.
    'THE BUSINESS — you are posting AS this business, ABOUT this business:',
    `  What it is: ${p.businessType ?? 'unknown'}`,
    `  Voice / tone: ${p.voiceTone ?? 'friendly, professional'}`,
    '',
    'THE AUDIENCE — these are the people who READ the post. Write FOR them,',
    'never AS them, and never describe their trade as if it were the business:',
    `  ${p.targetCustomer ?? 'unknown'}`,
    '',
  ];
  if (p.offers.length) lines.push(`Offers: ${p.offers.join('; ')}`);
  if (p.dosAndDonts.length) lines.push(`Dos and don'ts: ${p.dosAndDonts.join('; ')}`);
  if (p.blackoutTopics.length) lines.push(`Never mention: ${p.blackoutTopics.join('; ')}`);
  if (p.brandColors.length) lines.push(`Brand colors: ${p.brandColors.join(', ')}`);
  return lines.join('\n');
}
