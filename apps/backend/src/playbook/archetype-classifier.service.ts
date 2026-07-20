import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { BrandProfile } from '@prisma/client';
import { LlmService } from '../operator/llm/llm.service';
import { PlaybookService } from './playbook.service';

/**
 * Flow 1 — maps a freshly-onboarded customer to the archetype that should plan
 * their weeks. Confidence ≥ CONFIDENT attaches immediately; below it, the
 * business type is novel enough to deserve its own research pass (Flow 2).
 */

/** The bar from the engine spec: below this, research rather than guess. */
export const CONFIDENT = 0.75;

const Classification = z.object({
  slug: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});
export type Classification = z.infer<typeof Classification>;

@Injectable()
export class ArchetypeClassifier {
  private readonly log = new Logger(ArchetypeClassifier.name);

  constructor(
    private readonly llm: LlmService,
    private readonly playbook: PlaybookService,
  ) {}

  /**
   * Classify from what onboarding learned. Returns the best archetype and how
   * sure we are — `slug: null` means nothing in the playbook fits.
   */
  async classify(
    profile: Pick<
      BrandProfile,
      'businessType' | 'voiceTone' | 'targetCustomer' | 'offers'
    >,
    businessName?: string | null,
  ): Promise<Classification> {
    const description = profile.businessType?.trim();
    if (!description) {
      return { slug: null, confidence: 0, reasoning: 'No business type captured.' };
    }

    // Cheap exact/synonym match first — no tokens spent when the owner says
    // "coffee shop" and an archetype literally lists "coffee shop".
    const direct = await this.playbook.findByBusinessType(description);
    if (direct) {
      return {
        slug: direct.slug,
        confidence: 0.95,
        reasoning: `"${description}" matches ${direct.title} directly.`,
      };
    }

    const rows = await this.playbook.all();
    if (rows.length === 0) {
      return { slug: null, confidence: 0, reasoning: 'Playbook is empty.' };
    }

    const menu = rows
      .map((r) => `- ${r.slug} — ${r.title}. Covers: ${r.mapsFrom.join(', ')}`)
      .join('\n');

    try {
      const result = await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext: [
            'You match a small business to the best-fitting social-media',
            'strategy archetype from a fixed list. Return ONLY JSON:',
            '{"slug": string|null, "confidence": number 0-1, "reasoning": string}.',
            'Judge by how the business actually earns and what its content',
            'would look like — a mobile dog groomer belongs with pet services,',
            'not retail. Confidence is how well the archetype would ACTUALLY',
            'plan this business, not how confident you feel: a partial fit',
            '("axe-throwing venue" vs "boutique retail") is 0.4, not 0.8.',
            'Use null with low confidence when nothing genuinely fits — a',
            'wrong archetype is worse than none, because a research pass would',
            'have produced a correct one.',
          ].join(' '),
          prompt: [
            `Archetypes:\n${menu}`,
            '',
            `Business: ${businessName ?? '(unnamed)'} — ${description}`,
            profile.targetCustomer ? `Customers: ${profile.targetCustomer}` : '',
            profile.offers?.length ? `Offers: ${profile.offers.join(', ')}` : '',
            profile.voiceTone ? `Voice: ${profile.voiceTone}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          maxTokens: 300,
        },
        Classification,
      );

      // Guard against a hallucinated slug — the model must pick from the menu.
      if (result.slug && !rows.some((r) => r.slug === result.slug)) {
        this.log.warn(`classifier returned unknown slug "${result.slug}"`);
        return {
          slug: null,
          confidence: 0,
          reasoning: `Model proposed an archetype that doesn't exist (${result.slug}).`,
        };
      }
      return result;
    } catch (err) {
      this.log.warn(`classify failed: ${String(err)}`);
      return { slug: null, confidence: 0, reasoning: 'Classifier unavailable.' };
    }
  }
}
