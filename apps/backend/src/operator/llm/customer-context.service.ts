import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from './llm.service';

/**
 * The per-customer context engine.
 *
 * The brand profile is what an owner told us once, at signup. This is what they
 * keep telling us since — "I don't like that color", "keep them short", "always
 * tag the roaster" — plus what their own audience actually rewards. It is the
 * difference between posts that sound like a competent stranger and posts that
 * sound like this shop, getting more so every week.
 *
 * Two sources, exactly as asked for:
 *   1. Their words. Standing preferences pulled from the feedback they give on
 *      drafts, remembered rather than used once and forgotten.
 *   2. Their numbers. Which of THEIR post formats actually earn engagement,
 *      scoped to this one shop — not the pooled average for the trade.
 *
 * The whole thing is built to resist over-learning. A one-off edit ("make this
 * one shorter") must never become a standing rule that quietly rewrites every
 * future post, so extraction is deliberately conservative and every preference
 * carries how many times it has been seen.
 */

/** Below this many of the shop's own posts, its rates are noise, not signal. */
export const OWN_MIN_SAMPLES = 4;

/** Never feed more than this many preferences into a prompt — it should focus
 *  the model, not bury it. */
const MAX_PREFS_IN_PROMPT = 8;

/** What the extractor is allowed to return. */
const Extracted = z.object({
  preferences: z
    .array(
      z.object({
        text: z.string().min(3).max(160),
        kind: z.enum(['like', 'dislike', 'rule']).default('rule'),
      }),
    )
    .max(3),
});

@Injectable()
export class CustomerContextService {
  private readonly log = new Logger(CustomerContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Read a piece of owner feedback and remember any STANDING preference in it.
   *
   * The hard part is the distinction the model is asked to make: "make this one
   * shorter" changes one post and must be ignored here; "I like them short" is
   * a rule about all of them and is kept. Getting that wrong in the greedy
   * direction is how a service starts quietly degrading everything from a
   * single throwaway comment, so the prompt errs toward extracting nothing.
   *
   * Never throws into the caller — learning is a bonus on top of the redo the
   * owner actually asked for, and must not cost them that redo.
   */
  async learnFromFeedback(customerId: string, feedback: string): Promise<void> {
    const trimmed = feedback.trim();
    if (trimmed.length < 4) return;

    let extracted: z.infer<typeof Extracted>;
    try {
      extracted = await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext: '',
          customerId,
          maxTokens: 220,
          prompt: [
            'An owner of a small business just gave feedback on a social post we',
            'wrote for them. Pull out ONLY standing preferences — things that',
            'should hold for every future post, not a fix to this one post.',
            '',
            'Keep: dislikes and likes about style, tone, length, colour, topics,',
            'or wording ("I like them short", "stop using bright colours",',
            '"never mention decaf", "more behind-the-scenes").',
            'Discard: one-off edits to this specific post ("make THIS shorter",',
            '"swap the photo", "fix the date", "post it tomorrow"). If the',
            'feedback is only a one-off edit, return an empty list. When unsure,',
            'return nothing — a missed preference is cheap, a wrong one is not.',
            '',
            'Write each as a short instruction to whoever writes the next post',
            '("Keep captions short", "Avoid bright promotional colours").',
            '',
            `Feedback: "${trimmed.slice(0, 500)}"`,
            '',
            'Return JSON: {"preferences":[{"text":string,"kind":"like|dislike|rule"}]}.',
          ].join('\n'),
        },
        Extracted,
      );
    } catch (e) {
      this.log.warn(`preference extraction failed for ${customerId}: ${String(e)}`);
      return;
    }

    for (const pref of extracted.preferences) {
      await this.remember(customerId, pref.text, pref.kind);
    }
  }

  /**
   * Store a preference, or strengthen it if we already know it.
   *
   * Dedupe is by content-word overlap, not exact text, so "keep them short" and
   * "Keep captions short." collapse to one row whose count goes up rather than
   * two near-identical rules both crowding the prompt. Overlap rather than an
   * exact match because the extractor paraphrases the same idea differently
   * each time. Strengthening is what turns a tentative preference into a
   * confirmed one.
   */
  private async remember(customerId: string, text: string, kind: string): Promise<void> {
    const tokens = contentTokens(text);
    if (tokens.size === 0) return;

    const existing = await this.prisma.customerPreference.findMany({
      where: { customerId, active: true },
      select: { id: true, text: true, timesSeen: true },
    });
    const match = existing.find((p) => sameIdea(contentTokens(p.text), tokens));

    if (match) {
      await this.prisma.customerPreference.update({
        where: { id: match.id },
        data: { timesSeen: match.timesSeen + 1 },
      });
      this.log.log(`reinforced preference for ${customerId}: "${text}" (x${match.timesSeen + 1})`);
    } else {
      await this.prisma.customerPreference.create({
        data: { customerId, text: text.trim(), kind },
      });
      this.log.log(`learned preference for ${customerId}: "${text}"`);
    }
  }

  /** The active preferences for this shop, strongest first. */
  async preferences(customerId: string): Promise<
    { text: string; kind: string; timesSeen: number }[]
  > {
    return this.prisma.customerPreference.findMany({
      where: { customerId, active: true },
      orderBy: [{ timesSeen: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_PREFS_IN_PROMPT,
      select: { text: true, kind: true, timesSeen: true },
    });
  }

  /**
   * What has actually worked for THIS shop, from its own posts — not the pooled
   * average for its trade. Null until it has enough of its own history to mean
   * anything, which for a new shop is the honest answer.
   */
  async ownPerformanceHint(customerId: string): Promise<string | null> {
    const posts = await this.prisma.post.findMany({
      where: {
        customerId,
        status: 'published',
        metrics: { some: {} },
      },
      select: {
        archetype: true,
        metrics: { orderBy: { fetchedAt: 'desc' }, take: 1 },
      },
    });

    type Bucket = { samples: number; impressions: number; engagements: number };
    const byFormat = new Map<string, Bucket>();
    for (const post of posts) {
      const m = post.metrics[0];
      if (!m || m.impressions <= 0) continue;
      const b = byFormat.get(post.archetype) ?? { samples: 0, impressions: 0, engagements: 0 };
      b.samples += 1;
      b.impressions += m.impressions;
      b.engagements += m.likes + m.comments + m.shares + m.saves;
      byFormat.set(post.archetype, b);
    }

    const ranked = [...byFormat.entries()]
      .filter(([, b]) => b.samples >= OWN_MIN_SAMPLES)
      .map(([format, b]) => ({ format, rate: b.engagements / b.impressions, samples: b.samples }))
      .sort((a, b) => b.rate - a.rate);

    if (ranked.length === 0) return null;

    const parts = ranked
      .slice(0, 4)
      .map((r) => `${r.format} ${(r.rate * 100).toFixed(1)}% over ${r.samples} of their own posts`);
    return (
      "WHAT THIS SHOP'S OWN AUDIENCE REWARDS (measured from their posts, not the " +
      `trade average): ${parts.join('; ')}. Lean toward the stronger formats for ` +
      'this specific business, while keeping the week varied.'
    );
  }

  /**
   * The whole per-customer layer as one block for the prompt, or empty string
   * when there is nothing learned yet. Appended after the brand profile so it
   * reads as "and here is what we have learned since".
   */
  async contextBlock(customerId: string): Promise<string> {
    const [prefs, perf] = await Promise.all([
      this.preferences(customerId),
      this.ownPerformanceHint(customerId),
    ]);
    if (prefs.length === 0 && !perf) return '';

    const lines: string[] = ['', 'WHAT WE HAVE LEARNED ABOUT THIS BUSINESS SINCE SIGNUP:'];
    if (prefs.length) {
      lines.push('Preferences the owner has told us (follow these):');
      for (const p of prefs) {
        // A confirmed preference is stated plainly; a tentative one is flagged
        // so the model weights it lightly rather than treating one comment as law.
        lines.push(`- ${p.text}${p.timesSeen < 2 ? ' (mentioned once — weigh lightly)' : ''}`);
      }
    }
    if (perf) lines.push(perf);
    return lines.join('\n');
  }
}

/** Filler words that carry no preference meaning — dropped before comparison. */
const STOP = new Set([
  'please', 'the', 'a', 'an', 'to', 'it', 'them', 'they', 'your', 'our', 'and',
  'of', 'for', 'be', 'is', 'are', 'i', 'we', 'you', 'my', 'me', 'this', 'that',
  'these', 'those', 'keep', 'make', 'want', 'like', 'dont', 'do', 'not', 'more',
  'less', 'always', 'never', 'use', 'using', 'with', 'in', 'on', 'at',
]);

/** The meaning-carrying words of a preference, lower-cased and de-filler-ed. */
function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/**
 * Do two token sets describe the same preference? Uses overlap relative to the
 * smaller set, so "short" inside "captions short" still counts as the same
 * idea. The 0.6 threshold is deliberately forgiving of paraphrase but not so
 * loose that unrelated preferences ("short" vs "colour") ever merge.
 */
function sameIdea(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size) >= 0.6;
}
