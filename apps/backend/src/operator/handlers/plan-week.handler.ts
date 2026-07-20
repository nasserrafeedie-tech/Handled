import { Injectable, Logger } from '@nestjs/common';
import {
  type Task,
  type Result,
  PlanWeekLlmOutput,
  type PlanWeekResult,
} from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { resolveStrategy, strategyPlanningBlock } from '../llm/vertical-playbook';
import { TaskHandler, ok, fail } from './handler.interface';
import { archetypePlanningBlock } from '../../playbook/archetype-context';

/**
 * PLAN_WEEK (§7). Read brand_profile + recent metrics → produce a week's
 * calendar as strict JSON (planning runs on Sonnet 5, the voice tier). For each
 * slot that needs a real photo, create a shot_list_request so the Concierge can
 * ask the owner.
 */
@Injectable()
export class PlanWeekHandler implements TaskHandler<'PLAN_WEEK'> {
  readonly type = 'PLAN_WEEK' as const;
  private readonly log = new Logger(PlanWeekHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async handle(task: Extract<Task, { type: 'PLAN_WEEK' }>): Promise<Result> {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId: task.customer_id },
    });
    // The archetype is this business's STRATEGY — which formats, cadence, and
    // local-discovery moves actually work in its trade (engine task 15).
    const customer = await this.prisma.customer.findUnique({
      where: { id: task.customer_id },
      select: { archetypeSlug: true },
    });
    const archetype = customer?.archetypeSlug
      ? await this.prisma.playbookArchetype.findUnique({
          where: { slug: customer.archetypeSlug },
        })
      : null;
    if (!profile) {
      return fail(
        task.task_id,
        "I need to finish setting up your profile before I plan your week.",
        'no_brand_profile',
        `brand_profile missing for customer ${task.customer_id}`,
      );
    }

    const frequency =
      task.payload.posting_frequency ?? profile.postingFrequency ?? 3;
    const recentMetrics = await this.prisma.metric.findMany({
      where: { customerId: task.customer_id },
      orderBy: { fetchedAt: 'desc' },
      take: 20,
    });

    const context = buildBrandContext(profile);
    const prompt = [
      `Plan ${frequency} posts for the week starting ${task.payload.week_start.slice(0, 10)}.`,
      'Mix archetypes across the week (promo, behind_the_scenes, testimonial,',
      'educational_tip, product_spotlight, seasonal, ugc_repost, were_open).',
      'Prefer slots that use the owner\'s real photos.',
      archetype ? archetypePlanningBlock(archetype) : '',
      strategyPlanningBlock(resolveStrategy(profile)),
      recentMetrics.length
        ? `Recent performance signal (impressions): ${recentMetrics
            .map((m) => m.impressions)
            .join(', ')}. Lean into what worked.`
        : 'No performance history yet — plan a balanced first week.',
      'Return JSON: {"slots":[{"date","archetype","platform","best_time",',
      '"needs_asset","shot_list"}]}. Dates YYYY-MM-DD, best_time HH:MM,',
      'needs_asset boolean, shot_list ONE string (semicolons between shots).',
    ].join(' ');

    const planned = await this.llm.completeJson(
      { tier: 'voice', cachedContext: context, prompt, maxTokens: 1500 },
      PlanWeekLlmOutput,
    );

    // Create shot_list_requests for slots that need a real asset (§7).
    const shotListIds: string[] = [];
    for (const slot of planned.slots) {
      if (slot.needs_asset) {
        const req = await this.prisma.shotListRequest.create({
          data: {
            customerId: task.customer_id,
            prompt: slot.shot_list ?? `Photo for a ${slot.archetype} post on ${slot.date}`,
          },
        });
        shotListIds.push(req.id);
      }
    }

    const data: PlanWeekResult = {
      week_start: task.payload.week_start.slice(0, 10),
      slots: planned.slots,
      shot_list_request_ids: shotListIds,
    };

    const asks = shotListIds.length
      ? ` I'll need ${shotListIds.length} quick photo${shotListIds.length > 1 ? 's' : ''} from you.`
      : '';
    return ok(
      task.task_id,
      `Your week is planned — ${planned.slots.length} posts lined up.${asks}`,
      'done',
      data,
    );
  }
}
