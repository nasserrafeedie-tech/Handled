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
  // Interview answers the link can give, so the owner isn't asked them. Each
  // only when the pages actually show it; the owner is asked whatever is left.
  business_name: z.string().max(120).nullish(),
  business_type: z.string().max(200).nullish(),
  voice_tone: z.string().max(300).nullish(),
  target_customer: z.string().max(300).nullish(),
});
export type BusinessFindings = z.infer<typeof Findings> & {
  /** What the research filled in that was empty, to read back to the owner. */
  filled?: FilledFromLink;
};

/** The interview fields a lookup filled, with the values it used. */
export type FilledFromLink = {
  business_name?: string;
  business_type?: string;
  voice_tone?: string;
  target_customer?: string;
  offers?: string[];
};

/**
 * Merge findings into the profile without overwriting anything: research
 * fills gaps, and the owner's own words always win. Returns the profile and
 * customer writes, and what was filled, for the read-back.
 */
export function mergeFindings(
  profile: { businessType: string | null; voiceTone: string | null; targetCustomer: string | null; offers: string[] },
  businessName: string | null | undefined,
  findings: z.infer<typeof Findings>,
): { profile: Record<string, unknown>; customer: Record<string, unknown>; filled: FilledFromLink } {
  const clean = (v: string | null | undefined) => (v ?? '').trim() || undefined;
  const filled: FilledFromLink = {};
  const data: Record<string, unknown> = { businessResearch: findings.summary };
  const type = clean(findings.business_type);
  if (!profile.businessType && type) data.businessType = filled.business_type = type;
  const tone = clean(findings.voice_tone);
  if (!profile.voiceTone && tone) data.voiceTone = filled.voice_tone = tone;
  const who = clean(findings.target_customer);
  if (!profile.targetCustomer && who) data.targetCustomer = filled.target_customer = who;
  if (profile.offers.length === 0 && findings.offers.length > 0) {
    data.offers = filled.offers = findings.offers.slice(0, 8);
  }
  const name = clean(findings.business_name);
  const customer: Record<string, unknown> = {};
  if (!businessName?.trim() && name) customer.businessName = filled.business_name = name;
  return { profile: data, customer, filled };
}

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
      'Also fill these interview answers, each ONLY when the pages show it',
      '(omit or null otherwise, never guess):',
      '- business_name: its proper name',
      '- business_type: what it is and where ("family dental office in',
      '  Torrance"), not the name',
      '- voice_tone: how its own copy and posts sound, in a few personality',
      '  words ("warm, plain-spoken, a little playful")',
      '- target_customer: who it serves, as the pages say or show it',
      'Rules: facts you actually found only — never pad with guesses; if the',
      'link yields nothing, say so in summary and keep arrays empty. The',
      'summary is a tight brief (under 1500 chars) a caption writer will',
      'read before every post. highlights are 2-3 short "here is what I',
      'found" lines to text the owner, each concrete enough to prove we',
      'really looked ("Your carnitas plate gets named in half your reviews").',
      'Return JSON: {"summary": string, "offers": string[], "highlights":',
      'string[], "business_name": string|null, "business_type": string|null,',
      '"voice_tone": string|null, "target_customer": string|null} and',
      'nothing after it.',
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
    // owner's own answers.
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    if (!profile) return findings;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { businessName: true },
    });
    const merged = mergeFindings(profile, customer?.businessName, findings);
    await this.prisma.brandProfile.update({ where: { customerId }, data: merged.profile });
    if (Object.keys(merged.customer).length) {
      await this.prisma.customer.update({ where: { id: customerId }, data: merged.customer });
    }
    return { ...findings, filled: merged.filled };
  }
}
