import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { PlaybookArchetype } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../operator/llm/llm.service';
import { PlaybookService } from './playbook.service';
import { ArchetypeFields, normalizeBusinessType, slugify } from './playbook.types';

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
 * Note on sources: this runs inside the product, which has no web-search tool,
 * so the draft is the model's own knowledge, honestly labelled as such
 * (`sources: [{ kind: "model_knowledge" }]`) and capped in confidence. A
 * genuine web-researched pass — the Cowork deep-research session — can
 * overwrite the row later with real citations and a higher ceiling.
 */

/** Rows drafted without web citations can't be trusted like researched ones. */
const NO_CITATION_CEILING = 0.8;

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
      const draft = await this.draft(businessType);
      const verdict = await this.verify(businessType, draft);

      const confidence = Math.min(verdict.confidence, NO_CITATION_CEILING);
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
              kind: 'model_knowledge',
              note: 'Drafted from model knowledge, no web citations. Re-research with the deep-research pass to raise confidence.',
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
        `archetype "${slug}" created (${status}, confidence ${confidence.toFixed(2)})`,
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

  /** Draft every field of the archetype schema for this vertical. */
  private async draft(businessType: string): Promise<z.infer<typeof Draft>> {
    return this.llm.completeJson(
      {
        tier: 'voice',
        cachedContext: [
          'You write social-media strategy archetypes for a done-for-you',
          'service used by small LOCAL businesses. Return ONLY JSON matching',
          'the requested shape. Rules that make an archetype useful:',
          '- Be SPECIFIC to the trade. "Show your work" is useless; "the fade',
          '  taking shape mid-cut" is usable. Every idea must be executable by',
          '  a busy owner with a phone.',
          '- photoStyle and revenueMetric are single prose lines; every other',
          '  field is an array of short items.',
          '- mapsFrom lists the words owners actually use for this business.',
          '- reels are 3-5 concepts whose payoff is visible in the first',
          '  second. captionHooks are opening lines, in quotes.',
          '- discovery covers local search: keyword phrasing, geotags, Google',
          '  Business Profile, community tags.',
          '- Never invent statistics or cite studies you cannot name.',
          '- Respect trade-specific compliance in mistakes (patient privacy',
          '  for health, consent for before/afters, licensing claims for',
          '  contractors, no medical claims for wellness).',
        ].join('\n'),
        prompt: [
          `Business type: "${businessType}"`,
          '',
          'Return JSON with keys: title (a short archetype name covering this',
          'and similar businesses), mapsFrom[], platforms[], pillars[],',
          'topFormats[], cadence[], reels[], photoStyle (string),',
          'captionHooks[], discovery[], offers[], seasonal[], mistakes[],',
          'revenueMetric (string).',
        ].join('\n'),
        maxTokens: 2000,
      },
      Draft,
    );
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
   * Deliberate limit: this pass only RE-DRAFTS archetypes this engine wrote
   * from model knowledge. The seed archetypes came from a real web-research
   * pass with citations, and overwriting those with un-sourced model output
   * would quietly downgrade the playbook — so stale seed rows are flagged
   * `needs_review` for a proper research session instead. Refreshing those
   * well is the deep-research pass's job, not a cron's.
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

      const sources = Array.isArray(row.sources) ? (row.sources as unknown[]) : [];
      const selfWritten =
        sources.length > 0 &&
        sources.every(
          (s) => (s as { kind?: string })?.kind === 'model_knowledge',
        );

      if (!selfWritten) {
        if (row.status !== 'needs_review') {
          await this.prisma.playbookArchetype.update({
            where: { slug: row.slug },
            data: { status: 'needs_review' },
          });
          flagged.push(row.slug);
          this.log.log(
            `archetype "${row.slug}" is ${Math.round(ageDays)} days old and web-sourced — flagged for a real research pass`,
          );
        }
        continue;
      }

      if (refreshed.length >= limit) break;

      try {
        const seedType = row.mapsFrom[0] ?? row.title;
        const draft = await this.draft(seedType);
        const verdict = await this.verify(seedType, draft);
        const confidence = Math.min(verdict.confidence, NO_CITATION_CEILING);

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
                kind: 'model_knowledge',
                note: 'Refreshed by the weekly freshness job.',
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
