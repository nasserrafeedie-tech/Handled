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
import { ArchetypePerformanceService } from '../../playbook/archetype-performance.service';
import { isCarouselArchetype } from '../graphics/carousel-content';

/** The most photo asks an owner should get in one week. */
export const MAX_ASSET_ASKS = 2;

/**
 * Hold the week to a realistic number of photo asks.
 *
 * The prompt asks for this, but a prompt is a request and this is a guarantee.
 * Asked to plan a week, the model will happily mark every slot `needs_asset` —
 * and that has a worse consequence than nagging. A slot waiting on a photo is
 * skipped by both carousel and image generation, so a customer who never gets
 * round to sending pictures receives a week of bare text posts and never sees
 * the feature they upgraded for. Measured on a real account: 5 of 5 slots asked
 * for a photo, and not one carousel was built.
 *
 * When asks have to be given up, the carousel-eligible archetypes yield first.
 * They already have a strong automatic fallback — branded slides — whereas a
 * behind-the-scenes or we're-open post with no photo has nothing to fall back
 * on. The owner can still send a photo for any post at any time; this only
 * decides where we spend the asks.
 */
export function clampAssetAsks<T extends { archetype: string; needs_asset: boolean }>(
  slots: T[],
): T[] {
  const carousel = (s: T) => isCarouselArchetype(s.archetype as never);
  const asking = slots.filter((s) => s.needs_asset);

  // Photo-first slots first, then carousel-eligible ones. Sorting even when we
  // are inside the budget matters: a week that asks for exactly two photos and
  // happens to pick two carousel-eligible slots loses both carousels while
  // staying under the cap. Measured — coverage fell to one visual in five that
  // way. So carousel slots may hold at most one ask between them, whatever the
  // total, because each one they take costs a carousel we would otherwise build.
  const ordered = [...asking].sort(
    (a, b) => Number(carousel(a)) - Number(carousel(b)),
  );
  const keep = new Set<T>();
  let carouselAsks = 0;
  for (const s of ordered) {
    if (keep.size >= MAX_ASSET_ASKS) break;
    if (carousel(s)) {
      if (carouselAsks >= 1) continue;
      carouselAsks++;
    }
    keep.add(s);
  }
  return slots.map((s) =>
    s.needs_asset && !keep.has(s) ? { ...s, needs_asset: false } : s,
  );
}

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
    private readonly performance: ArchetypePerformanceService,
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
    // Flow 4: what has actually worked for this kind of business, pooled
    // across every customer on the same archetype. Null until there is enough
    // evidence, which is the honest answer for a new archetype.
    const measured = customer?.archetypeSlug
      ? await this.performance.planningHint(customer.archetypeSlug)
      : null;

    const context = buildBrandContext(profile);
    const prompt = [
      `Plan ${frequency} posts for the week starting ${task.payload.week_start.slice(0, 10)}.`,
      'Mix archetypes across the week (promo, behind_the_scenes, testimonial,',
      'educational_tip, product_spotlight, seasonal, ugc_repost, were_open).',
      // Asking for a photo on every slot reads as homework and gets ignored,
      // and it starves the slots that would otherwise produce a carousel. Ask
      // only where a real photo is genuinely the point — people and places.
      'Set needs_asset TRUE on AT MOST 2 slots in the whole week, and only where',
      'a real photo is the point of the post (the team, the space, a finished',
      'job). Leave it FALSE elsewhere — we design those posts ourselves.',
      // The playbook for some trades (dentists, restaurants) pushes Google
      // Business Profile, Reels, and Stories — none of which are a "platform"
      // we can post to. Constrain it up front so the week does not silently
      // shrink when those slots get dropped downstream.
      'platform MUST be one of exactly: instagram, facebook, tiktok, threads. ' +
        'Reels and Stories are Instagram formats — use "instagram", not ' +
        '"reels"/"stories". Do NOT use Google Business Profile, X, LinkedIn or ' +
        'YouTube as a platform; we do not publish to them. For a local health ' +
        'or service business, favour instagram and facebook.',
      archetype ? archetypePlanningBlock(archetype) : '',
      strategyPlanningBlock(resolveStrategy(profile)),
      // A bare list of impression counts used to sit here. It told the model
      // that some numbers had happened without saying which post earned them,
      // so "lean into what worked" was unactionable. This names the format.
      measured ?? 'No measured results for this kind of business yet — plan a balanced week.',
      'Return JSON: {"slots":[{"date","archetype","platform","best_time",',
      '"needs_asset","shot_list"}]}. Dates YYYY-MM-DD, best_time HH:MM,',
      'needs_asset boolean, shot_list ONE string (semicolons between shots).',
    ].join(' ');

    const planned = await this.llm.completeJson(
      { tier: 'voice', cachedContext: context, prompt, maxTokens: 1500, customerId: task.customer_id },
      PlanWeekLlmOutput,
    );

    // Hold the model to a realistic number of photo asks before anything is
    // persisted, so the rest of the week is free to be designed rather than
    // sitting idle waiting on pictures that may never arrive.
    const asked = planned.slots.filter((s) => s.needs_asset).length;
    planned.slots = clampAssetAsks(planned.slots);
    const kept = planned.slots.filter((s) => s.needs_asset).length;
    if (kept < asked) {
      this.log.warn(
        `planner asked for ${asked} photos this week for ${task.customer_id}; ` +
          `kept ${kept} so the rest of the week can be designed`,
      );
    }

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
