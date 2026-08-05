import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { GraphicsService } from '../graphics/graphics.service';
import { CANVAS, stableSeed, type BrandTheme, type SlideSpec } from '../graphics/slide-templates';
import { resolveBrandColors } from '../graphics/brand-palette';
import { logoDataUri } from '../graphics/logo-colors';
import { ImageGenService } from '../graphics/image-gen.service';
import { ImageSafetyService } from '../graphics/image-safety.service';
import {
  buildImagePrompt,
  shouldRefuseSubject,
  stripOwnershipClaims,
  subjectInstruction,
  type ImageBrief,
} from '../graphics/image-prompt';
import { z } from 'zod';

const HeroSubject = z.object({ subject: z.string().min(1).max(120) });
import {
  carouselInstruction,
  CarouselLlmOutput,
  tierHasCarousel,
  type CarouselBrief,
} from '../graphics/carousel-content';
import { ModerationService } from '../guardrails/moderation.service';
import { detectFabrication } from '../guardrails/fabrication';
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
    private readonly images: ImageGenService,
    private readonly safety: ImageSafetyService,
    private readonly moderation: ModerationService,
  ) {}

  /**
   * A generated hero photo for the carousel's cover slide — the same guarded
   * pipeline the standalone image handler uses: pick a subject, refuse a place
   * or a specific business, build the constrained prompt, generate, then look at
   * the actual pixels and reject a fabricated place. Returns a data URI to
   * composite behind the cover headline, or null when any step declines — a
   * missing hero is a plain-text cover, never a failed carousel.
   */
  private async generateHeroImage(
    customerId: string,
    businessType: string,
    caption: string,
  ): Promise<string | null> {
    if (!this.images.configured) return null;
    try {
      const brief: ImageBrief = { businessType, caption: caption.slice(0, 200) };
      const picked = await this.llm.completeJson(
        { tier: 'bulk', cachedContext: '', prompt: subjectInstruction(brief), maxTokens: 120, customerId },
        HeroSubject,
      );
      const cleaned = stripOwnershipClaims(picked.subject.trim());
      if (!cleaned || shouldRefuseSubject(cleaned)) {
        this.log.warn(`hero subject refused for ${customerId}: "${picked.subject}"`);
        return null;
      }
      const image = await this.images.generate(buildImagePrompt(brief, cleaned), { aspect: '1:1' });
      const verdict = await this.safety.isPlace(image.bytes, image.contentType);
      if (verdict.isPlace) {
        this.log.warn(`hero image discarded for ${customerId}: depicts a place (${verdict.reason})`);
        return null;
      }
      return `data:${image.contentType};base64,${image.bytes.toString('base64')}`;
    } catch (e) {
      this.log.warn(`hero image generation failed for ${customerId}: ${String(e)}`);
      return null;
    }
  }

  async handle(task: Extract<Task, { type: 'GENERATE_CAROUSEL' }>): Promise<Result> {
    const [customer, profile, post] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: task.customer_id },
        select: { businessName: true, planTier: true, aiImagesOptIn: true, trustLevel: true },
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
    // On a redo (replace_existing) the post necessarily HAS media — the deck
    // being replaced — so the check moves to what the media actually is: only
    // the owner's own upload blocks; slides we assembled are fair to rebuild.
    if (task.payload.replace_existing) {
      const ownerMedia = await this.prisma.mediaAsset.findFirst({
        where: { postId: post.id, source: 'owner_upload' },
        select: { id: true },
      });
      if (ownerMedia) {
        return ok(task.task_id, 'That post already has a picture on it.', 'done',
          { skipped: 'owner_media_present' });
      }
    } else if (post.mediaRefs.length > 0) {
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
      ownerNote: task.payload.owner_feedback ?? null,
    };
    let slidesCopy: CarouselLlmOutput['slides'];
    try {
      const gen = await this.llm.completeJson(
        {
          tier: 'voice',
          // The slides deserve the same brand grounding as the caption —
          // offers, voice, and the researched facts about THIS business.
          // Without it the deck can only stretch the caption thin, and the
          // CTA has no idea how customers actually engage.
          cachedContext: profile ? buildBrandContext(profile) : '',
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

    // The slides are a SEPARATE generation from the caption — the caption
    // cleared the §8 gate, these did not. So run the same guardrails over the
    // slide text before it is rendered onto images and attached: a slide can
    // invent a stat/quote/event or surface an owner blackout topic the caption
    // was scrubbed of. On any hit, don't ship bad slides — fall back to a plain
    // (caption-only) post, exactly like a copy failure.
    const slideText = slidesCopy
      .map((s) => [s.headline, s.body].filter(Boolean).join(' '))
      .join('  ');
    const faked = detectFabrication(slideText);
    const verdict = await this.moderation.screen({
      caption: slideText,
      hashtags: [],
      blackoutTopics: profile?.blackoutTopics ?? [],
    });
    if (faked.length || !verdict.passed) {
      const why = faked.length
        ? `fabrication: ${faked.map((f) => f.name).join(', ')}`
        : `moderation: ${verdict.reasons.join(', ')}`;
      this.log.warn(`carousel slides for ${post.id} flagged (${why}) — keeping it a plain post`);
      return fail(task.task_id,
        "I couldn't lay that one out as slides — I'll keep it as a plain post.",
        'carousel_content_flagged', why, false);
    }

    // Real brand colors if we have them, else a stable palette distinct to this
    // business — never the one shared default that made colorless feeds look
    // alike. Seeded off the same customer id as the design rotation.
    const pal = resolveBrandColors(profile?.brandColors, task.customer_id);
    // The real logo, composited onto each slide's footer when we have one. A
    // missing/unreadable logo degrades to no logo — never fails the render.
    let logo: string | undefined;
    if (profile?.logoRef) {
      const bytes = await this.storage.get(profile.logoRef);
      if (bytes) logo = logoDataUri(bytes, profile.logoRef.split('.').pop() ?? 'png');
    }
    const theme: BrandTheme = {
      primary: pal.primary,
      secondary: pal.secondary,
      brandName: customer?.businessName ?? undefined,
      style: (profile?.visualStyle as BrandTheme['style']) ?? undefined,
      logoDataUri: logo,
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
    // A redo must also LOOK different, or "redo the carousel" returns the same
    // surfaces with new words. Slide assets from earlier renders of THIS post
    // persist, so their count is a deterministic salt: 0 on a first render
    // (identical behavior to before), and it moves on every rebuild.
    const [made, priorSlides] = await Promise.all([
      this.prisma.post.count({ where: { customerId: task.customer_id } }),
      this.prisma.mediaAsset.count({ where: { postId: post.id, source: 'assembled' } }),
    ]);
    const brandOffset = stableSeed(task.customer_id);
    const specs: SlideSpec[] = slidesCopy.map((s, i) => ({
      kind: s.kind,
      headline: s.headline,
      body: s.body,
      ctaLabel: s.cta_label,
      seed: made + brandOffset + priorSlides,
      variant: i,
    }));

    // If the owner opted into generated photography, give the COVER slide a
    // generated hero image with its headline over it — a mix of a real photo
    // treatment and text slides, not five text cards. Opt-in only, and additive:
    // without consent (the default) the carousel is unchanged. A place-image or
    // any failure falls back to the plain-text cover, never a failed carousel.
    let usedAiImage = false;
    if (customer.aiImagesOptIn && specs.length > 0) {
      const hero = await this.generateHeroImage(
        task.customer_id,
        profile?.businessType ?? 'local business',
        post.caption,
      );
      if (hero) {
        specs[0] = { ...specs[0], photo: hero, photoLayout: 'full' };
        usedAiImage = true;
      }
    }

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

    // Attach the slides in order. Approval state is normally left as the draft
    // handler set it — a carousel is a faithful re-rendering of a caption that
    // already cleared the trust gate. BUT a generated hero photo IS a new claim,
    // like any AI image: it is disclosed at publish (aiGeneratedMedia) and forced
    // back to the owner's eyes regardless of trust, exactly as the standalone
    // image handler does.
    await this.prisma.post.update({
      where: { id: post.id },
      data: {
        mediaRefs: refs,
        // A generated hero is always DISCLOSED (aiGeneratedMedia). It is also
        // forced back to the owner's REVIEW — except on full_auto, where the
        // owner has made two explicit choices: opt into generated imagery, and
        // publish without per-post review. Requiring approval anyway would
        // contradict both. The hard SAFETY floor is untouched: the vision place-
        // check already rejected a fabricated place before we got here, at every
        // trust level. So full_auto waives review, not safety.
        ...(usedAiImage
          ? {
              aiGeneratedMedia: true,
              ...(customer.trustLevel === 'full_auto'
                ? {}
                : { approvalState: 'awaiting_owner' as const }),
            }
          : {}),
      },
    });

    this.log.log(
      `built a ${refs.length}-slide carousel for post ${post.id}` +
        (usedAiImage ? ' (with a generated hero image)' : ''),
    );
    return ok(task.task_id,
      `I turned this one into a ${refs.length}-slide carousel — have a look.`,
      'done',
      { slides: refs.length, media_refs: refs });
  }
}
