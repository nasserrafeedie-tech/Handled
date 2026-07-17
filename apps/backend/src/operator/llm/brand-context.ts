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
    `Business type: ${p.businessType ?? 'unknown'}`,
    `Voice / tone: ${p.voiceTone ?? 'friendly, professional'}`,
    `Target customer: ${p.targetCustomer ?? 'unknown'}`,
  ];
  if (p.offers.length) lines.push(`Offers: ${p.offers.join('; ')}`);
  if (p.dosAndDonts.length) lines.push(`Dos and don'ts: ${p.dosAndDonts.join('; ')}`);
  if (p.blackoutTopics.length) lines.push(`Never mention: ${p.blackoutTopics.join('; ')}`);
  if (p.brandColors.length) lines.push(`Brand colors: ${p.brandColors.join(', ')}`);
  return lines.join('\n');
}
