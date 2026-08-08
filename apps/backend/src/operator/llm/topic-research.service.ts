import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { researchWithSearch, extractJsonObject } from './web-research';

/**
 * Topic research (§ engagement research, Aug 2026): the blandness fix.
 *
 * The drafter and the deck writer are forbidden from inventing facts — which
 * is right, and which also caps them at politely rephrasing the caption. The
 * reference-quality decks all run on CONCRETE specifics ("even 30 seconds
 * between your back teeth makes a real difference"). This service goes and
 * GETS those specifics: a real web-search pass over the post's topic that
 * returns verified facts, the myths people believe, and the numbers that
 * surprise — the raw material that separates a deck someone saves from
 * wallpaper. Owner's explicit call: spend for quality, don't cut costs.
 *
 * The findings become the ONLY sanctioned source of claims beyond the brand
 * profile, so the fabrication guardrails keep their teeth: everything
 * surprising in a post traces to either the owner or a searched source.
 */

const FactSheet = z.object({
  /** Verified concrete facts — numbers, mechanisms, thresholds. */
  facts: z
    .array(
      z.object({
        fact: z.string().min(1).max(240),
        source: z.string().min(1).max(200),
      }),
    )
    .max(8)
    .default([]),
  /** Things people commonly believe that are wrong — contrarian fuel. */
  myths: z.array(z.string().max(240)).max(4).default([]),
  /** What people actually get wrong in practice. */
  mistakes: z.array(z.string().max(240)).max(4).default([]),
});
export type TopicFactSheet = z.infer<typeof FactSheet>;

@Injectable()
export class TopicResearchService {
  private readonly log = new Logger(TopicResearchService.name);

  /**
   * Research one post topic. Returns a formatted fact block for prompts, or
   * null on any failure — the pipeline must degrade to profile-only writing,
   * never stall a draft on a search hiccup. Bounded at 75s.
   */
  async factBlock(
    topic: string,
    businessType: string,
  ): Promise<string | null> {
    try {
      const run = (async () => {
        const { text, searches, sources } = await researchWithSearch({
          model: process.env.LLM_MODEL_VOICE ?? 'claude-opus-5',
          system:
            'You are a fact researcher for a social post. Find CONCRETE, ' +
            'verifiable specifics — numbers, thresholds, mechanisms — from ' +
            'reputable sources. Never invent; skip anything you cannot ' +
            'source. No testimonials, no quotes from individuals.',
          prompt:
            `Research this topic for an Instagram post by an independent ${businessType}:\n` +
            `"""${topic.slice(0, 400)}"""\n\n` +
            'Find: (1) 3-6 concrete facts with numbers or mechanisms a reader ' +
            "would find surprising or useful; (2) 1-3 myths people commonly " +
            'believe about this that are wrong; (3) 1-3 mistakes people ' +
            'actually make in practice.\n\n' +
            'Return JSON: {"facts":[{"fact","source"}],"myths":[],"mistakes":[]}. ' +
            'source = publication name, not a URL. Facts must be stable and ' +
            'general (no news, no dated events).',
          maxTokens: 4000,
          maxSearches: 5,
          fetchUrls: false,
        });
        const sheet = FactSheet.parse(JSON.parse(extractJsonObject(text)));
        this.log.log(
          `topic research "${topic.slice(0, 60)}": ${searches} searches, ` +
            `${sources.length} sources, ${sheet.facts.length} facts`,
        );
        return sheet;
      })();
      const sheet = await Promise.race([
        run,
        new Promise<null>((r) => setTimeout(() => r(null), 75_000)),
      ]);
      if (!sheet || (sheet.facts.length === 0 && sheet.myths.length === 0)) {
        return null;
      }
      return formatFactBlock(sheet);
    } catch (e) {
      this.log.warn(`topic research failed for "${topic.slice(0, 60)}": ${String(e)}`);
      return null;
    }
  }
}

/** The prompt block both the caption drafter and the deck writer receive. */
export function formatFactBlock(sheet: TopicFactSheet): string {
  return [
    'RESEARCHED MATERIAL (web-verified). These — and ONLY these — may add',
    'numbers, claims, or mechanisms beyond the brand profile. Use the',
    'strongest ones; never cite the source names in the copy itself:',
    ...sheet.facts.map((f) => `- FACT: ${f.fact} (${f.source})`),
    ...sheet.myths.map((m) => `- MYTH people believe: ${m}`),
    ...sheet.mistakes.map((m) => `- MISTAKE people make: ${m}`),
  ].join('\n');
}
