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
import { CustomerContextService } from '../llm/customer-context.service';
import { ModerationService } from '../guardrails/moderation.service';
import { PublishGateService } from '../guardrails/publish-gate.service';
import { TaskHandler, ok, fail } from './handler.interface';

/** REGENERATE_POST (§7). Owner didn't like it — regenerate using their feedback. */
@Injectable()
export class RegeneratePostHandler implements TaskHandler<'REGENERATE_POST'> {
  readonly type = 'REGENERATE_POST' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly moderation: ModerationService,
    private readonly gate: PublishGateService,
    private readonly customerContext: CustomerContextService,
  ) {}

  async handle(task: Extract<Task, { type: 'REGENERATE_POST' }>): Promise<Result> {
    const post = await this.prisma.post.findFirst({
      where: { id: task.payload.post_id, customerId: task.customer_id },
    });
    if (!post) {
      return fail(task.task_id, "I couldn't find that post to redo.", 'post_not_found', task.payload.post_id);
    }
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId: task.customer_id },
    });
    if (!profile) {
      return fail(task.task_id, 'Your profile needs setup first.', 'no_brand_profile', task.customer_id);
    }

    // A revise is the moment an owner tells us how they like their posts, so
    // it is where the per-customer context engine learns. Fire-and-forget: the
    // redo they asked for must not wait on, or fail because of, the learning.
    const feedback = task.payload.owner_feedback ?? '';
    void this.customerContext.learnFromFeedback(task.customer_id, feedback);

    const context =
      buildBrandContext(profile) +
      (await this.customerContext.contextBlock(task.customer_id));
    const prompt = [
      `Rewrite this ${post.archetype} post for ${post.platform}.`,
      `Previous caption: "${post.caption ?? ''}".`,
      `Owner feedback: "${feedback}".`,
      'Return JSON: {"caption": string, "hashtags": string[]}.',
    ].join(' ');

    const gen = await this.llm.completeJson(
      { tier: 'bulk', cachedContext: context, prompt, maxTokens: 600, customerId: task.customer_id },
      CaptionLlmOutput,
    );

    const verdict = await this.moderation.screen({
      caption: gen.caption,
      hashtags: gen.hashtags,
      blackoutTopics: profile.blackoutTopics,
    });
    if (!verdict.passed) {
      return fail(task.task_id, "Let me try that again — the redo needs a tweak.", 'moderation_blocked', verdict.reasons.join(', '));
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: task.customer_id } });
    const risk = this.gate.classifyRisk(gen.caption);
    const decision = this.gate.decide(customer!.trustLevel, risk);

    await this.prisma.post.update({
      where: { id: post.id },
      data: {
        caption: gen.caption,
        hashtags: gen.hashtags,
        riskLevel: risk,
        moderationState: 'passed',
        approvalState: decision.approvalState,
        status: decision.autoPublishAllowed ? 'approved' : 'pending_approval',
      },
    });

    const data: DraftPostResult = {
      post_id: post.id,
      platform: post.platform,
      archetype: post.archetype,
      caption: gen.caption,
      hashtags: gen.hashtags,
      media_refs: post.mediaRefs,
      scheduled_time: post.scheduledTime ? post.scheduledTime.toISOString() : null,
      risk_level: risk,
      // Rewording a caption should not also buy a new picture. An owner asking
      // for different words would otherwise pay for a fresh generation each
      // time they nudge the copy.
      needs_image: false,
    };
    return ok(task.task_id, `Reworked it: "${gen.caption.slice(0, 120)}"`, 'pending_approval', data);
  }
}
