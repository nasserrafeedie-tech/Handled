import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { GraphicsService } from '../graphics/graphics.service';
import { CANVAS, CANVAS_H, stableSeed, type BrandTheme, type SlideSpec } from '../graphics/slide-templates';
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
import { subjectPreferences } from '../../concierge/photo-walk';
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
   * A generated photo for one slide — the same guarded pipeline the standalone
   * image handler uses: pick a subject from the slide's own copy, refuse a
   * place or a specific business, build the constrained prompt, generate, then
   * look at the actual pixels and reject a fabricated place. Returns a data
   * URI to composite behind the slide's text, or null when any step declines —
   * a missing image is a designed text slide, never a failed carousel.
   */
  private async generateSlideImage(
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
      // The fact block the caption was researched from — same verified
      // material, no second search.
      research: post.researchNotes ?? null,
    };
    // The newsroom pipeline (owner's call, Aug 2026: maximum quality, cost
    // is not the constraint): three full decks from three editorial lenses
    // in parallel, a judge to pick the winner, an editor to tighten it. Any
    // stage failing degrades to the best surviving draft — the extremes buy
    // quality, never fragility.
    const cachedContext = profile ? buildBrandContext(profile) : '';
    const base = carouselInstruction(brief);
    const LENSES = [
      'ANGLE FOR THIS DRAFT — the contrarian: lead with what everyone gets ' +
        'wrong or should STOP doing. Take one position a timid competitor ' +
        'would never post.',
      'ANGLE FOR THIS DRAFT — the surprising specific: open on the most ' +
        'counterintuitive concrete fact available and build the deck around ' +
        'why it changes what the reader should do.',
      'ANGLE FOR THIS DRAFT — the keeper: a reference the reader saves and ' +
        'sends. The checklist, the signs, the what-to-ask — complete enough ' +
        'to be useful forever.',
    ];
    const attempts = await Promise.allSettled(
      LENSES.map((lens) =>
        this.llm.completeJson(
          {
            tier: 'voice',
            cachedContext,
            prompt: `${base}\n\n${lens}`,
            maxTokens: 1600,
            customerId: task.customer_id,
          },
          CarouselLlmOutput,
        ),
      ),
    );
    const candidates = attempts
      .filter((a): a is PromiseFulfilledResult<CarouselLlmOutput> => a.status === 'fulfilled')
      .map((a) => a.value.slides);
    if (candidates.length === 0) {
      const why = attempts
        .map((a) => (a.status === 'rejected' ? String(a.reason) : ''))
        .filter(Boolean)
        .join(' | ');
      return fail(task.task_id,
        "I couldn't lay that one out as slides — I'll keep it as a plain post.",
        'carousel_copy_failed', why, true);
    }

    let slidesCopy: CarouselLlmOutput['slides'] = candidates[0];
    if (candidates.length > 1) {
      try {
        const judged = await this.llm.completeJson(
          {
            tier: 'voice',
            cachedContext,
            prompt: [
              `You are judging ${candidates.length} carousel drafts for the post below. Score each on:`,
              'stop-the-scroll (would the cover freeze a thumb), save-worthiness',
              '(is it useful again later), specificity (concrete numbers and',
              'mechanisms over vibes), and voice (said to one person, with a',
              'position). Pick the single strongest deck.',
              '',
              `The caption: """${post.caption}"""`,
              ...candidates.map((c, i) => `\nDRAFT ${i}:\n${JSON.stringify(c, null, 1)}`),
              '',
              'Return JSON: {"winner": <draft index>, "notes": "what the winner',
              'should tighten, and any single slide worth stealing from a loser"}.',
            ].join('\n'),
            maxTokens: 800,
            customerId: task.customer_id,
          },
          // Truncate long judge notes rather than reject them — a chatty
          // judge killed the whole pass with a max() on the first live run.
          z.object({ winner: z.number().int(), notes: z.string().transform((s) => s.slice(0, 1000)) }),
        );
        const idx =
          Number.isInteger(judged.winner) && judged.winner >= 0 && judged.winner < candidates.length
            ? judged.winner
            : 0;
        slidesCopy = candidates[idx];

        // The editor pass: tighten the winner per the judge's notes and cut
        // any slide that doesn't earn its place — material sets the length.
        const edited = await this.llm.completeJson(
          {
            tier: 'voice',
            cachedContext,
            prompt: [
              'You are the editor. Tighten this winning carousel draft:',
              JSON.stringify({ slides: slidesCopy }, null, 1),
              '',
              `The judge's notes: """${judged.notes}"""`,
              '',
              'Rules: cut any slide that restates another or exists to reach a',
              'count (never below 3 total, keep exactly one title first and one',
              'cta last); every headline under 8 words, every body under ~20;',
              'keep the concrete numbers, sharpen the position, change nothing',
              'that was already strong.',
              'Return JSON: {"slides": [...]} in the same shape.',
            ].join('\n'),
            maxTokens: 1600,
            customerId: task.customer_id,
          },
          CarouselLlmOutput,
        );
        if (edited.slides.length >= 3) slidesCopy = edited.slides;
      } catch (e) {
        this.log.warn(
          `deck judge/editor pass failed for ${post.id} — shipping the first draft: ${String(e)}`,
        );
      }
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
      total: slidesCopy.length,
    }));

    // Generated photography through the deck. Two doors in: the owner opted
    // into generated imagery, or the business is on PRO, where it's part of
    // the tier (owner's call, Aug 2026) — consent still governs standalone
    // generated photos and the Growth tier. Behind either door, one image PER
    // text-bearing slide: cover full-bleed, body slides as photo bands,
    // capped at 4 per deck. Owner feedback drove this: the photo slide was
    // "the best one", all-text middles read boring, and the margins carry a
    // few generations per deck. Each image is subject-picked from its own
    // slide's copy and takes the full refusal + place-check path; a failure
    // degrades that ONE slide to the designed surface, never the deck. The
    // aiGeneratedMedia disclosure + forced review below full_auto apply as
    // soon as any image lands.
    let usedAiImage = false;
    if (specs.length > 0) {
      const targets = specs
        .map((_, i) => i)
        .filter((i) => i === 0 || specs[i].kind === 'body')
        .slice(0, 4);

      // REAL photos first — the walk bank (subject-tagged, reusable) beats
      // any generation on every measure we researched, and needs no tier
      // door: an owner's own photos are always allowed on their posts. Each
      // photo is used once per deck; the cover prefers the money subjects.
      const walk = await this.prisma.mediaAsset.findMany({
        where: {
          customerId: task.customer_id,
          kind: 'image',
          source: 'owner_upload',
          subject: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        take: 40,
      });
      const taken = new Set<string>();
      const pickReal = (prefs: string[]): string | null => {
        for (const p of prefs) {
          const found = walk.find((w) => !taken.has(w.id) && w.subject === p);
          if (found) {
            taken.add(found.id);
            return found.r2Key;
          }
        }
        return null;
      };
      const realKeys = targets.map((i) =>
        i === 0
          ? pickReal(subjectPreferences(post.archetype))
          : pickReal(['hands_at_work', 'process', 'detail', 'tool', 'workspace', 'station', 'team', 'community', 'todays_best', 'owner_face']),
      );
      await Promise.all(
        targets.map(async (i, k) => {
          const key = realKeys[k];
          if (!key) return;
          try {
            const photo = await this.graphics.fetchPhoto(this.storage.publicUrl(key));
            specs[i] = { ...specs[i], photo, photoLayout: i === 0 ? 'full' : 'band' };
          } catch (e) {
            this.log.warn(`walk photo ${key} fetch failed: ${String(e)}`);
          }
        }),
      );

      // Generation fills only the slides no real photo covered, and only
      // behind the doors: AI-images opt-in, or the Pro tier where generated
      // imagery is part of the plan (owner's call, Aug 2026). Editorial
      // still-life style; every image runs refusal + place-check; a failure
      // degrades that ONE slide to the designed surface. aiGeneratedMedia
      // disclosure + forced review below full_auto apply only when a
      // GENERATED image actually lands — real photos need no disclosure.
      const missing = targets.filter((i, k) => !realKeys[k] && !specs[i].photo);
      if ((customer.aiImagesOptIn || customer.planTier === 'pro') && missing.length) {
        const generated = await Promise.all(
          missing.map((i) => {
            const copy = slidesCopy[i];
            const text =
              i === 0
                ? post.caption!
                : [copy.headline, copy.body].filter(Boolean).join(' — ');
            return this.generateSlideImage(
              task.customer_id,
              profile?.businessType ?? 'local business',
              text,
            );
          }),
        );
        missing.forEach((i, k) => {
          const img = generated[k];
          if (!img) return;
          specs[i] = { ...specs[i], photo: img, photoLayout: i === 0 ? 'full' : 'band' };
          usedAiImage = true;
        });
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
          height: CANVAS_H,
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
        (usedAiImage ? ' (with generated slide imagery)' : ''),
    );
    return ok(task.task_id,
      `I turned this one into a ${refs.length}-slide carousel — have a look.`,
      'done',
      { slides: refs.length, media_refs: refs });
  }
}
