import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import {
  researchWithSearch,
  extractJsonObject,
} from '../operator/llm/web-research';

/**
 * "Look you up" (§ onboarding): given the link an owner pastes during the
 * interview, research THEIR actual business on the live web — services, menu,
 * specials, how they describe themselves, what reviewers praise — and distill
 * it into the brand profile.
 *
 * Why this exists: generic interview questions can't fit every business, and
 * owners won't volunteer detail over SMS. The web already has it. One pasted
 * link replaces a dozen questions the owner would never have answered.
 *
 * Runs in the background while the interview continues; findings are merged
 * non-destructively (only empty profile fields are filled — the owner's own
 * words always win) and the businessResearch brief feeds every later draft.
 */

const Findings = z.object({
  /** The distilled brief the drafter will read. Facts only, no fluff. */
  summary: z.string().min(1).max(2000),
  /** Concrete promotable things found: services, menu items, specials. */
  offers: z.array(z.string().max(120)).max(12).default([]),
  /** 2-3 highlights worth reading back to the owner over SMS. */
  highlights: z.array(z.string().max(160)).max(4).default([]),
});
export type BusinessFindings = z.infer<typeof Findings>;

@Injectable()
export class BusinessResearchService {
  private readonly log = new Logger(BusinessResearchService.name);
  /** In-flight lookups by customer, so first-week drafting can await one. */
  private readonly inFlight = new Map<string, Promise<BusinessFindings | null>>();

  constructor(private readonly prisma: PrismaService) {}

  /** The lookup currently running for this customer, if any. */
  pending(customerId: string): Promise<BusinessFindings | null> | undefined {
    return this.inFlight.get(customerId);
  }

  /**
   * Kick off (or join) the lookup for this customer. Resolves with the
   * findings after they are persisted to the brand profile — null when
   * research failed or found nothing usable. Never throws.
   */
  lookUp(
    customerId: string,
    url: string,
    context: { businessType?: string | null; businessName?: string | null },
  ): Promise<BusinessFindings | null> {
    const running = this.inFlight.get(customerId);
    if (running) return running;
    const job = this.run(customerId, url, context)
      .catch((err) => {
        this.log.warn(`business lookup failed for ${customerId}: ${String(err)}`);
        return null;
      })
      .finally(() => this.inFlight.delete(customerId));
    this.inFlight.set(customerId, job);
    return job;
  }

  private async run(
    customerId: string,
    url: string,
    context: { businessType?: string | null; businessName?: string | null },
  ): Promise<BusinessFindings | null> {
    const system = [
      'You research ONE specific small business on the live web and return',
      'JSON. You are given its link (website, Instagram, or Google listing)',
      'and what the owner said it is. FETCH THE GIVEN LINK FIRST and read the',
      'actual pages — a small business site is often too new for search',
      'indexes, and the page itself is the richest source. Then search for',
      'the rest — social profiles, Google listing, reviews — and extract',
      'facts a social media writer needs:',
      '- what it sells/does, named concretely (dishes, services, packages,',
      '  price points if published)',
      '- specials, signature items, what reviewers repeatedly praise',
      '- hours/location details worth mentioning in posts',
      '- how the business describes itself (their own phrases are gold)',
      'Rules: facts you actually found only — never pad with guesses; if the',
      'link yields nothing, say so in summary and keep arrays empty. The',
      'summary is a tight brief (under 1500 chars) a caption writer will',
      'read before every post. highlights are 2-3 short "here is what I',
      'found" lines to text the owner, each concrete enough to prove we',
      'really looked ("Your carnitas plate gets named in half your reviews").',
      'Return JSON: {"summary": string, "offers": string[], "highlights":',
      'string[]} and nothing after it.',
    ].join('\n');

    const prompt = [
      `Link from the owner: ${url}`,
      context.businessName ? `Business name: ${context.businessName}` : '',
      context.businessType ? `Owner describes it as: ${context.businessType}` : '',
      '',
      'Research this specific business and return the JSON.',
    ]
      .filter(Boolean)
      .join('\n');

    const { text, sources, searches } = await researchWithSearch({
      model: process.env.LLM_MODEL_VOICE ?? 'claude-opus-5',
      system,
      prompt,
      maxTokens: 8000,
      maxSearches: 6,
      fetchUrls: true,
    });
    const findings = Findings.parse(JSON.parse(extractJsonObject(text)));
    this.log.log(
      `looked up ${customerId}: ${searches} searches, ${sources.length} sources, ` +
        `${findings.offers.length} offers found`,
    );

    // Merge non-destructively: research fills gaps, never overwrites the
    // owner's own answers. offers only when the interview hasn't filled them.
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    if (!profile) return findings;
    await this.prisma.brandProfile.update({
      where: { customerId },
      data: {
        businessResearch: findings.summary,
        ...(profile.offers.length === 0 && findings.offers.length > 0
          ? { offers: findings.offers.slice(0, 8) }
          : {}),
      },
    });
    return findings;
  }
}
