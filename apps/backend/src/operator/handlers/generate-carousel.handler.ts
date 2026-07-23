import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';
import { LlmService } from '../llm/llm.service';
import { GraphicsService } from '../graphics/graphics.service';
import { CANVAS, stableSeed, type BrandTheme, type SlideSpec } from '../graphics/slide-templates';
import { toSvgColors } from '../graphics/color.util';
import {
  carouselInstruction,
  CarouselLlmOutput,
  tierHasCarousel,
  type CarouselBrief,
} from '../graphics/carousel-content';
import { TaskHandler, ok, fail } from './handler.interface';

/**
 * GENERATE_CAROUSEL. Turns an informational post with no owner photo into a
 * swipeable, branded carousel — the Growth+ flagship feature.
 *
 * Carousels are the main reason to move up from Starter, so there is a plan-tier
 * gate (Growth and above). There is no opt-in gate the way generated photos have
 * one: a carousel is a rendered graphic, not a fabricated photograph, so it
 * carries none of the "real photo of a place that doesn't exist" risk. The other
 * gate that stays is §7 — a photo the owner actually sent wins over anything we
 * assemble.
 */
@Injectable()
export class GenerateCarouselHandler implements TaskHandler<'GENERATE_CAROUSEL'> {
  readonly type = 'GENERATE_CAROUSEL' as const;
  private readonly log = new Logger(GenerateCarouselHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly graphics: GraphicsService,
    private readonly storage: StorageService,
  ) {}

  async handle(task: Extract<Task, { type: 'GENERATE_CAROUSEL' }>): Promise<Result> {
    const [customer, profile, post] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: task.customer_id },
        select: { businessName: true, planTier: true },
      }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
      this.prisma.post.findUnique({ where: { id: task.payload.post_id } }),
    ]);

    if (!customer || !post) {
      return fail(task.task_id, 'I lost track of that post.', 'not_found',
        `customer/post missing for ${task.payload.post_id}`);
    }
    // Carousels are the Growth+ headline feature (§ pricing). Re-checked here as
    // well as by the caller, since a plan can change between drafting and this.
    if (!tierHasCarousel(customer.planTier)) {
      return fail(task.task_id,
        'Swipeable carousels are part of the Growth plan — reply UPGRADE and I\'ll send the details.',
        'tier_not_eligible', `planTier=${customer.planTier}`);
    }
    // A photo the owner sent always wins (§7). Re-checked here as well as by the
    // caller, because a real photo can land between drafting and this running.
    if (post.mediaRefs.length > 0) {
      return ok(task.task_id, 'That post already has a picture on it.', 'done',
        { skipped: 'owner_media_present' });
    }
    if (!post.caption) {
      return fail(task.task_id, "There's no caption to build slides from yet.",
        'no_caption', `post ${post.id} has no caption`);
    }

    // Write the slide copy from the caption. Treated like any generated text:
    // if the model fails we fall back to a plain photo ask rather than shipping
    // a broken graphic.
    const brief: CarouselBrief = {
      businessType: profile?.businessType ?? 'local business',
      archetype: post.archetype as CarouselBrief['archetype'],
      caption: post.caption,
      brandName: customer?.businessName,
    };
    let slidesCopy: CarouselLlmOutput['slides'];
    try {
      const gen = await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext: '',
          prompt: carouselInstruction(brief),
          maxTokens: 700,
          customerId: task.customer_id,
        },
        CarouselLlmOutput,
      );
      slidesCopy = gen.slides;
    } catch (e) {
      return fail(task.task_id,
        "I couldn't lay that one out as slides — I'll keep it as a plain post.",
        'carousel_copy_failed', String(e), true);
    }

    const theme: BrandTheme = {
      primary: toSvgColors(profile?.brandColors ?? [])[0] ?? '#2C3E50',
      secondary: toSvgColors(profile?.brandColors ?? [])[1],
      brandName: customer?.businessName ?? undefined,
      style: (profile?.visualStyle as BrandTheme['style']) ?? undefined,
    };

    // One seed for the whole carousel: every slide shares a surface and palette,
    // so the set reads as one designed post rather than five unrelated cards.
    //
    // The seed mixes the post count with a STABLE per-brand offset. The count
    // alone was the fingerprint an owner caught: customer A's 3rd post and
    // customer B's 3rd post both seeded off "3", so two unrelated businesses got
    // the identical surface and shapes — open one feed, recognise it in another.
    // Anchoring to the brand pushes each business onto its own path through the
    // rotation, so a look repeating across two companies takes a real collision,
    // not a guarantee. The count still moves per post (feed variety within a
    // brand) and the offset is deterministic (a re-render is identical).
    const made = await this.prisma.post.count({ where: { customerId: task.customer_id } });
    const brandOffset = stableSeed(task.customer_id);
    const specs: SlideSpec[] = slidesCopy.map((s, i) => ({
      kind: s.kind,
      headline: s.headline,
      body: s.body,
      seed: made + brandOffset,
      variant: i,
    }));

    let pngs: Buffer[];
    try {
      pngs = this.graphics.renderCarousel(specs, theme);
    } catch (e) {
      return fail(task.task_id,
        "I couldn't build that carousel — I'll keep it as a plain post.",
        'render_failed', String(e), true);
    }

    const batch = randomUUID();
    const refs: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const r2Key = `${task.customer_id}/${batch}/slide-${i + 1}.png`;
      await this.storage.put(r2Key, pngs[i], 'image/png');
      await this.prisma.mediaAsset.create({
        data: {
          customerId: task.customer_id,
          postId: post.id,
          kind: 'image',
          source: 'assembled',
          r2Key,
          contentType: 'image/png',
          width: CANVAS,
          height: CANVAS,
        },
      });
      refs.push(r2Key);
    }

    // Attach the slides in order. Approval state is left as the draft handler
    // set it: a carousel is a faithful re-rendering of a caption that already
    // cleared the trust gate, not a new claim like a fabricated photo — so a
    // trusted customer's post still auto-publishes with its slides on it.
    await this.prisma.post.update({
      where: { id: post.id },
      data: { mediaRefs: refs },
    });

    this.log.log(`built a ${refs.length}-slide carousel for post ${post.id}`);
    return ok(task.task_id,
      `I turned this one into a ${refs.length}-slide carousel — have a look.`,
      'done',
      { slides: refs.length, media_refs: refs });
  }
}
