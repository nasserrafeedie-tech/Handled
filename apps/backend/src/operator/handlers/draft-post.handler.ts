import { Injectable } from '@nestjs/common';
import {
  type Task,
  type Result,
  CaptionLlmOutput,
  type DraftPostResult,
} from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { playbookFor, ALT_TEXT_RULE } from '../llm/playbook';
import { resolveStrategy } from '../llm/vertical-playbook';
import { ModerationService } from '../guardrails/moderation.service';
import { PublishGateService } from '../guardrails/publish-gate.service';
import { TaskHandler, ok, fail } from './handler.interface';

/**
 * DRAFT_POST (§7). Generate a platform-specific caption + hashtags (bulk tier =
 * Haiku), classify risk, run moderation (§8), then route to the approval state
 * the trust ramp dictates. Media attach/generation is a seam (owner photo > AI).
 */
@Injectable()
export class DraftPostHandler implements TaskHandler<'DRAFT_POST'> {
  readonly type = 'DRAFT_POST' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly moderation: ModerationService,
    private readonly gate: PublishGateService,
  ) {}

  async handle(task: Extract<Task, { type: 'DRAFT_POST' }>): Promise<Result> {
    const [customer, profile] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: task.customer_id } }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
    ]);
    if (!customer || !profile) {
      return fail(
        task.task_id,
        "I need your profile set up before I can write posts.",
        'no_brand_profile',
        `customer/profile missing for ${task.customer_id}`,
      );
    }

    const { platform, archetype } = task.payload;
    const context = buildBrandContext(profile);

    // Anti-repetition memory. Without this the model re-derives the same
    // "safe" caption every week — same opening, same rhythm, same sign-off —
    // and the playbook's own rules make that worse by giving every post an
    // identical skeleton. Showing it what it already published is the cheapest
    // fix that actually works.
    const recent = await this.prisma.post.findMany({
      where: { customerId: task.customer_id, caption: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { caption: true, archetype: true },
    });
    const prompt = [
      `Write one ${archetype} post for ${platform}.`,
      task.payload.prompt_notes ? `Notes: ${task.payload.prompt_notes}.` : '',
      '',
      // How this platform actually ranks content — see llm/playbook.ts.
      playbookFor(platform),
      '',
      (() => { const st = resolveStrategy(profile); return `STRATEGY FOR THIS BUSINESS: ${st.mix}\nIf the archetype fits, draw on: ${st.ideas.slice(0, 3).join(' · ')}`; })(),
      '',
      recent.length
        ? [
            '',
            'ALREADY POSTED for this business — do not repeat these. Vary the',
            'opening line, the sentence rhythm, and the closing call to action.',
            'Reuse of an opening or a sign-off from this list is a failure:',
            ...recent.map((r) => `- (${r.archetype}) ${flatten(r.caption ?? '')}`),
          ].join('\n')
        : '',
      '',
      'HARD RULES: Never invent a named customer, patient, or a specific',
      'story about one. For a testimonial archetype with no real quote in the',
      'notes, write general sentiment ("our regulars tell us…") or an',
      'invitation — a fabricated review is a firing offense. Hashtags are',
      'single words: no spaces, no # prefix.',
      'Return JSON: {"caption": string, "hashtags": string[], "alt_text": string}.',
      'Caption in the brand voice. Hashtags without the # prefix.',
      ALT_TEXT_RULE,
    ]
      .filter(Boolean)
      .join('\n');

    const gen = await this.llm.completeJson(
      { tier: 'bulk', cachedContext: context, prompt, maxTokens: 600 },
      CaptionLlmOutput,
    );

    // §8 moderation before anything is persisted as publishable.
    const verdict = await this.moderation.screen({
      caption: gen.caption,
      hashtags: gen.hashtags,
      blackoutTopics: profile.blackoutTopics,
    });

    const risk = this.gate.classifyRisk(gen.caption);
    const decision = this.gate.decide(customer.trustLevel, risk);

    // Owner photos beat anything we can generate (§7: owner photo > AI). Pull
    // the oldest banked photo — one they texted in that no post has claimed —
    // so real photography flows into the week automatically.
    const bankedPhoto = await this.prisma.mediaAsset.findFirst({
      where: {
        customerId: task.customer_id,
        postId: null,
        kind: 'image',
        source: 'owner_upload',
      },
      orderBy: { createdAt: 'asc' },
    });

    // Stamp which playbook archetype this post was planned from, so
    // per-archetype performance can be aggregated later (engine Flow 4).
    const planned = await this.prisma.customer.findUnique({
      where: { id: task.customer_id },
      select: { archetypeSlug: true },
    });

    const post = await this.prisma.post.create({
      data: {
        customerId: task.customer_id,
        archetype,
        playbookSlug: planned?.archetypeSlug ?? null,
        platform,
        caption: gen.caption,
        altText: gen.alt_text ?? null,
        hashtags: gen.hashtags,
        mediaRefs: bankedPhoto ? [bankedPhoto.r2Key] : [],
        scheduledTime: task.payload.scheduled_time
          ? new Date(task.payload.scheduled_time)
          : null,
        riskLevel: risk,
        moderationState: verdict.passed ? 'passed' : 'blocked',
        approvalState: verdict.passed ? decision.approvalState : 'awaiting_owner',
        status: verdict.passed
          ? decision.autoPublishAllowed
            ? 'approved'
            : 'pending_approval'
          : 'draft',
      },
    });

    if (bankedPhoto) {
      await this.prisma.mediaAsset.update({
        where: { id: bankedPhoto.id },
        data: { postId: post.id },
      });
    }

    if (!verdict.passed) {
      return fail(
        task.task_id,
        "I drafted something but it needs a tweak before it's ready — I'll rework it.",
        'moderation_blocked',
        `blocked: ${verdict.reasons.join(', ')}`,
      );
    }

    const data: DraftPostResult = {
      post_id: post.id,
      platform,
      archetype,
      caption: gen.caption,
      hashtags: gen.hashtags,
      media_refs: [],
      scheduled_time: post.scheduledTime ? post.scheduledTime.toISOString() : null,
      risk_level: risk,
    };

    const status: Result['status'] = decision.autoPublishAllowed
      ? 'done'
      : 'pending_approval';
    const summary = decision.autoPublishAllowed
      ? `Draft ready and cleared to post: "${preview(gen.caption)}"`
      : `Here's a draft for your OK: "${preview(gen.caption)}"`;

    return ok(task.task_id, summary, status, data);
  }
}

/** One line per past caption keeps the prompt cheap and readable. */
function flatten(caption: string): string {
  const one = caption.replace(/\s+/g, ' ').trim();
  return one.length > 140 ? `${one.slice(0, 137)}…` : one;
}

function preview(caption: string): string {
  return caption.length > 120 ? `${caption.slice(0, 117)}...` : caption;
}
