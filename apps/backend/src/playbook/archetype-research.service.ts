import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { PlaybookArchetype } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../operator/llm/llm.service';
import { PlaybookService } from './playbook.service';
import { ArchetypeFields, normalizeBusinessType, slugify } from './playbook.types';
import {
  researchWithSearch,
  extractJsonObject,
  MAX_SEARCHES_PER_PASS,
  type ResearchSource,
} from '../operator/llm/web-research';

/**
 * Flow 2 — the self-updating part. A business type nothing in the playbook
 * covers triggers one research pass, which writes a full archetype the next
 * customer of that type reuses instantly.
 *
 * Two deliberate constraints from the spec:
 * - **Idempotent per normalized business type**, so two "axe-throwing venue"
 *   signups on the same morning research once, not twice.
 * - **Verified before it's trusted.** A second pass grades the draft and sets
 *   `confidence`; a weak draft lands as `needs_review` rather than silently
 *   planning someone's month.
 *
 * Sources: the draft runs against Anthropic's server-side `web_search` tool,
 * so it is real research — every archetype carries the URLs Claude actually
 * cited. If search is unavailable or returns nothing usable, the pass falls
 * back to the model's own knowledge, labels the row honestly, and accepts a
 * lower confidence ceiling. That distinction is what makes the store worth
 * compounding: sourced knowledge outranks recall, and the row records which
 * it is.
 */

/** A draft with no citations is recall, not research — cap it lower. */
const NO_CITATION_CEILING = 0.8;
/** Web-researched drafts can be trusted further, but never blindly. */
const RESEARCHED_CEILING = 0.95;

const Draft = ArchetypeFields.extend({
  title: z.string().min(1).max(80),
});

// Truncate rather than reject: a verifier that writes 700 characters of good
// analysis shouldn't fail the pass and cost us the whole archetype.
const Verdict = z.object({
  confidence: z.number().min(0).max(1),
  weakFields: z
    .array(z.unknown())
    .max(30)
    .default([])
    .transform((a) => a.map((v) => String(v).slice(0, 80))),
  notes: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).slice(0, 1500)),
});

@Injectable()
export class ArchetypeResearchService {
  private readonly log = new Logger(ArchetypeResearchService.name);
  /** In-flight research, keyed by normalized business type (dedupe). */
  private readonly inFlight = new Map<string, Promise<PlaybookArchetype | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly playbook: PlaybookService,
  ) {}

  /**
   * Research an archetype for `businessType`, or return the existing one.
   * Safe to call concurrently for the same type — the second caller awaits the
   * first's promise instead of starting a duplicate pass.
   */
  async ensureArchetypeFor(businessType: string): Promise<PlaybookArchetype | null> {
    const key = normalizeBusinessType(businessType);
    if (!key) return null;

    const existing = await this.playbook.findByBusinessType(businessType);
    if (existing) return existing;

    const running = this.inFlight.get(key);
    if (running) {
      this.log.log(`research for "${key}" already running — joining it`);
      return running;
    }

    const job = this.research(businessType, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, job);
    return job;
  }

  private async research(
    businessType: string,
    key: string,
  ): Promise<PlaybookArchetype | null> {
    this.log.log(`researching new archetype for "${businessType}"`);
    try {
      const { draft, sources, searches } = await this.draft(businessType);
      const verdict = await this.verify(businessType, draft);

      const researched = sources.length > 0;
      const confidence = Math.min(
        verdict.confidence,
        researched ? RESEARCHED_CEILING : NO_CITATION_CEILING,
      );
      const status = confidence >= 0.6 ? 'researched' : 'needs_review';
      const slug = await this.uniqueSlug(slugify(draft.title));

      const row = await this.prisma.playbookArchetype.create({
        data: {
          slug,
          title: draft.title,
          // Always keep the owner's own words as a matchable synonym, so the
          // next identical signup hits the cheap direct match.
          mapsFrom: Array.from(new Set([...draft.mapsFrom, key])),
          platforms: draft.platforms,
          pillars: draft.pillars,
          topFormats: draft.topFormats,
          cadence: draft.cadence,
          reels: draft.reels,
          photoStyle: draft.photoStyle,
          captionHooks: draft.captionHooks,
          discovery: draft.discovery,
          offers: draft.offers,
          seasonal: draft.seasonal,
          mistakes: draft.mistakes,
          revenueMetric: draft.revenueMetric,
          sources: [
            {
              kind: researched ? 'web_research' : 'model_knowledge',
              note: researched
                ? `Researched on the live web (${searches} searches, ${sources.length} sources cited).`
                : 'Web search unavailable — drafted from model knowledge. Re-research to raise confidence.',
              citations: sources,
              verifierNotes: verdict.notes,
              weakFields: verdict.weakFields,
              at: new Date().toISOString(),
            },
          ],
          confidence,
          status,
          researchedAt: new Date(),
        },
      });

      this.log.log(
        `archetype "${slug}" created (${status}, confidence ${confidence.toFixed(2)}, ` +
          `${researched ? `${sources.length} web sources` : 'model knowledge'})`,
      );

      // Anyone parked on a weak partial match whose business this new
      // archetype actually describes gets upgraded. Without this, a customer
      // whose research failed on signup day is stuck with a wrong strategy
      // forever — and now that owners can read their plan, "wrong" is visible.
      await this.rescueWeakMatches(row).catch((e) =>
        this.log.warn(`re-attach sweep failed for "${slug}": ${String(e)}`),
      );
      // Keep the human doc in step. Never let a doc-write failure lose the row.
      await this.playbook
        .regenerateDoc()
        .catch((e) => this.log.warn(`doc regen after research failed: ${String(e)}`));
      return row;
    } catch (err) {
      this.log.error(`archetype research failed for "${businessType}": ${String(err)}`);
      return null;
    }
  }

  /**
   * Research this vertical on the live web and draft the full archetype.
   *
   * Returns the draft plus the sources Claude cited. Falls back to the
   * model's own knowledge (no sources) when search is unavailable — the
   * caller lowers the confidence ceiling accordingly.
   */
  private async draft(
    businessType: string,
  ): Promise<{ draft: z.infer<typeof Draft>; sources: ResearchSource[]; searches: number }> {
    const system = [
      'You research social-media strategy for small LOCAL businesses and',
      'return it as JSON. Search the web before answering — you are being',
      'asked what actually works for this trade RIGHT NOW, not what you',
      'remember. Prioritise: platform-published engagement data, 2025-2026',
      'benchmark studies, and repeated patterns across real accounts in this',
      'trade. Rules that make an archetype useful:',
      '- Be SPECIFIC to the trade. "Show your work" is useless; "the fade',
      '  taking shape mid-cut" is usable. Every idea must be executable by a',
      '  busy owner with a phone in under a minute.',
      '- photoStyle and revenueMetric are single prose lines; every other',
      '  field is an array of short items.',
      '- mapsFrom lists the words owners actually use for this business.',
      '- reels are 3-5 concepts whose payoff is visible in the first second.',
      '  captionHooks are opening lines, in quotes.',
      '- discovery covers local search: keyword phrasing, geotags, Google',
      '  Business Profile, community tags.',
      '- Cite what you find. Never invent statistics.',
      '- Respect trade-specific compliance in mistakes (patient privacy for',
      '  health, consent for before/afters, licensing claims for contractors,',
      '  no medical claims for wellness, child-photo rules for childcare).',
      'Keep any prose before the JSON to two sentences at most — you are',
      'being read by a program, not a person. End your reply with the JSON',
      'object and nothing after it.',
    ].join('\n');

    const prompt = [
      `Business type: "${businessType}"`,
      '',
      'Research what drives engagement and local customers for this kind of',
      'business on Instagram, TikTok, Facebook, and Google Business Profile.',
      '',
      'Then return a JSON object with keys: title (a short archetype name',
      'covering this and similar businesses), mapsFrom[], platforms[],',
      'pillars[], topFormats[], cadence[], reels[], photoStyle (string),',
      'captionHooks[], discovery[], offers[], seasonal[], mistakes[],',
      'revenueMetric (string).',
    ].join('\n');

    // Real research first; model knowledge only if that path fails.
    try {
      const { text, sources, searches } = await researchWithSearch({
        model: process.env.LLM_MODEL_VOICE ?? 'claude-sonnet-5',
        system,
        prompt,
        maxTokens: 8000,
        maxSearches: MAX_SEARCHES_PER_PASS,
      });
      const draft = Draft.parse(JSON.parse(extractJsonObject(text)));
      this.log.log(
        `web research for "${businessType}": ${searches} searches, ${sources.length} sources`,
      );
      return { draft, sources, searches };
    } catch (err) {
      this.log.warn(
        `web research failed for "${businessType}", falling back to model knowledge: ${String(err)}`,
      );
    }

    // No tools on this path — strip the search instruction, or the model
    // stalls waiting for a capability it hasn't been given.
    const offlineSystem = system
      .replace(
        /Search the web before answering[\s\S]*?trade\./,
        'Draw on what you know about this trade.',
      )
      .replace('- Cite what you find. Never invent statistics.', '- Never invent statistics.');
    const draft = await this.llm.completeJson(
      { tier: 'voice', cachedContext: offlineSystem, prompt, maxTokens: 3000 },
      Draft,
    );
    return { draft, sources: [], searches: 0 };
  }

  /** Cheap adversarial pass: is this specific and trustworthy, or filler? */
  private async verify(
    businessType: string,
    draft: z.infer<typeof Draft>,
  ): Promise<z.infer<typeof Verdict>> {
    try {
      return await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext: [
            'You grade a drafted social-media strategy for a local business',
            'type. Be skeptical and specific. Return ONLY JSON:',
            '{"confidence": 0-1, "weakFields": string[], "notes": string}.',
            'Mark a field weak when it is generic filler that would fit any',
            'business ("post consistently", "engage your audience"), when it',
            'invents statistics, or when it ignores this trade\'s realities',
            '(compliance, seasonality, how it actually gets customers).',
            'confidence is how safely this could plan a real customer\'s month:',
            '0.8+ genuinely specialist, 0.5-0.7 usable but generic in places,',
            'below 0.5 would embarrass us.',
          ].join(' '),
          prompt: `Business type: "${businessType}"\n\nDraft:\n${JSON.stringify(draft, null, 1).slice(0, 6000)}`,
          maxTokens: 500,
        },
        Verdict,
      );
    } catch (err) {
      this.log.warn(`verify pass failed, defaulting to needs_review: ${String(err)}`);
      return {
        confidence: 0.5,
        weakFields: [],
        notes: 'Verification pass failed; row needs human review.',
      };
    }
  }

  /**
   * Flow 3 — weekly freshness. Algorithms move, so an archetype older than
   * ~180 days (90 for heavily-used ones) is stale.
   *
   * Re-researches archetypes the engine wrote itself, on the live web. Seed
   * rows — the hand-curated ones from social-playbook.md — are flagged for
   * review rather than auto-rewritten: a human curated those, and a cron
   * shouldn't silently replace them. A refresh that scores materially worse
   * than the row it would replace is discarded.
   */
  async refreshStale(limit = 3): Promise<{
    refreshed: string[];
    flagged: string[];
  }> {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const rows = await this.prisma.playbookArchetype.findMany({
      orderBy: { researchedAt: 'asc' },
    });

    const refreshed: string[] = [];
    const flagged: string[] = [];

    for (const row of rows) {
      const ageDays = (now - row.researchedAt.getTime()) / day;
      const staleAfter = row.usageCount >= 5 ? 90 : 180;
      if (ageDays < staleAfter) continue;

      // Seed rows came from a human research pass with a curated doc; this job
      // won't silently rewrite those. Everything the engine wrote itself —
      // whether from the web or from recall — is fair game to re-research,
      // and the confidence guard below stops a worse draft from landing.
      if (row.status === 'seed') {
        await this.prisma.playbookArchetype.update({
          where: { slug: row.slug },
          data: { status: 'needs_review' },
        });
        flagged.push(row.slug);
        this.log.log(
          `seed archetype "${row.slug}" is ${Math.round(ageDays)} days old — flagged for review rather than auto-rewritten`,
        );
        continue;
      }

      if (refreshed.length >= limit) break;

      try {
        const seedType = row.mapsFrom[0] ?? row.title;
        const { draft, sources, searches } = await this.draft(seedType);
        const verdict = await this.verify(seedType, draft);
        const researched = sources.length > 0;
        const confidence = Math.min(
          verdict.confidence,
          researched ? RESEARCHED_CEILING : NO_CITATION_CEILING,
        );

        // Never let a worse draft replace a better one.
        if (confidence + 0.05 < row.confidence) {
          this.log.log(
            `refresh for "${row.slug}" scored lower (${confidence.toFixed(2)} vs ${row.confidence.toFixed(2)}) — keeping the existing row`,
          );
          await this.prisma.playbookArchetype.update({
            where: { slug: row.slug },
            data: { researchedAt: new Date() },
          });
          continue;
        }

        await this.prisma.playbookArchetype.update({
          where: { slug: row.slug },
          data: {
            platforms: draft.platforms,
            pillars: draft.pillars,
            topFormats: draft.topFormats,
            cadence: draft.cadence,
            reels: draft.reels,
            photoStyle: draft.photoStyle,
            captionHooks: draft.captionHooks,
            discovery: draft.discovery,
            offers: draft.offers,
            seasonal: draft.seasonal,
            mistakes: draft.mistakes,
            revenueMetric: draft.revenueMetric,
            mapsFrom: Array.from(new Set([...row.mapsFrom, ...draft.mapsFrom])),
            confidence,
            status: confidence >= 0.6 ? 'researched' : 'needs_review',
            researchedAt: new Date(),
            sources: [
              {
                kind: researched ? 'web_research' : 'model_knowledge',
                note: researched
                  ? `Refreshed by the weekly freshness job (${searches} searches, ${sources.length} sources).`
                  : 'Refreshed by the weekly freshness job from model knowledge — web search unavailable.',
                citations: sources,
                verifierNotes: verdict.notes,
                weakFields: verdict.weakFields,
                at: new Date().toISOString(),
              },
            ],
          },
        });
        refreshed.push(row.slug);
        this.log.log(`archetype "${row.slug}" refreshed (${confidence.toFixed(2)})`);
      } catch (err) {
        this.log.warn(`refresh failed for "${row.slug}": ${String(err)}`);
      }
    }

    if (refreshed.length > 0) {
      await this.playbook
        .regenerateDoc()
        .catch((e) => this.log.warn(`doc regen after refresh failed: ${String(e)}`));
    }
    return { refreshed, flagged };
  }

  /**
   * Move customers off a low-confidence guess onto a freshly researched
   * archetype that genuinely covers them. Conservative on purpose: only
   * customers below the confident bar, and only when their own words match
   * one of the new archetype's synonyms.
   */
  private async rescueWeakMatches(row: PlaybookArchetype): Promise<void> {
    const stranded = await this.prisma.customer.findMany({
      where: {
        archetypeConfidence: { lt: 0.75 },
        NOT: { archetypeSlug: row.slug },
        status: { in: ['active', 'onboarding'] },
      },
      select: { id: true, archetypeSlug: true, brandProfile: { select: { businessType: true } } },
    });
    if (stranded.length === 0) return;

    const synonyms = [row.title, ...row.mapsFrom]
      .map(normalizeBusinessType)
      .filter((s) => s.length >= 4);

    for (const c of stranded) {
      const needle = normalizeBusinessType(c.brandProfile?.businessType ?? '');
      if (!needle) continue;
      const matches = synonyms.some(
        (syn) => needle === syn || needle.includes(syn) || syn.includes(needle),
      );
      if (!matches) continue;

      await this.playbook.attach(c.id, row.slug, row.confidence);
      this.log.log(
        `re-attached ${c.id} from "${c.archetypeSlug ?? 'none'}" to "${row.slug}" ` +
          `(business: "${c.brandProfile?.businessType}")`,
      );
    }
  }

  /** "florists" already taken → "florists-2". */
  private async uniqueSlug(base: string): Promise<string> {
    let slug = base || 'archetype';
    for (let n = 2; n < 50; n++) {
      const clash = await this.prisma.playbookArchetype.findUnique({ where: { slug } });
      if (!clash) return slug;
      slug = `${base}-${n}`;
    }
    return `${base}-${Date.now()}`;
  }
}
