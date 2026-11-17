import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Task, type Result, CaptionLlmOutput } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { playbookFor, ALT_TEXT_RULE } from '../llm/playbook';
import { tierHas } from '../tier-entitlements';
import { ModerationService } from '../guardrails/moderation.service';
import { PublishGateService } from '../guardrails/publish-gate.service';
import type { BrandTheme } from '../graphics/slide-templates';
import { toSvgColors } from '../graphics/color.util';
import { StorageService } from '../../common/storage.service';
import { AnimatedReelService } from '../video/animated/animated-reel.service';
import { reelLook } from '../video/animated/look';
import { buildSpec, pickOffer, type SpecContext } from '../video/animated/copy';
import { onScreenText, type AnimatedReelSpec } from '../video/animated/spec';
import { animatedReelsOn } from '../video/animated/flag';
import { TaskHandler, ok, fail } from './handler.interface';
import { reelReadyText } from './reel-ready';

/**
 * ANIMATED_REEL (Pro, behind ANIMATED_REELS=1). A motion-graphics reel drawn
 * by Handled's own engine: an animated promo for an offer, or a before/after
 * wipe between two of the owner's photos. No footage needed and nothing to
 * pay per render, which is what makes a reel a week possible for a business
 * that never films anything.
 *
 * Same pipeline as every other post from here: checked words, moderation and
 * the risk gate on everything a viewer reads, then a draft for the owner's yes.
 */
@Injectable()
export class AnimatedReelHandler implements TaskHandler<'ANIMATED_REEL'> {
  readonly type = 'ANIMATED_REEL' as const;
  private readonly log = new Logger(AnimatedReelHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly animated: AnimatedReelService,
    private readonly llm: LlmService,
    private readonly moderation: ModerationService,
    private readonly gate: PublishGateService,
    private readonly storage: StorageService,
  ) {}

  async handle(task: Extract<Task, { type: 'ANIMATED_REEL' }>): Promise<Result> {
    const p = task.payload;
    if (!animatedReelsOn()) {
      return fail(task.task_id, "Animated reels aren't switched on yet.", 'feature_off', 'ANIMATED_REELS is not 1');
    }
    const [customer, profile] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: task.customer_id } }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
    ]);
    if (!customer || !profile) {
      return fail(task.task_id, 'I need your profile set up first.', 'no_brand_profile', task.customer_id);
    }
    if (!tierHas(customer.planTier, 'reel')) {
      return fail(
        task.task_id,
        "Reels are part of the Pro plan. Reply UPGRADE and I'll send the details.",
        'plan_gate',
        `planTier=${customer.planTier}`,
      );
    }

    // What the reel is about.
    let source: string;
    let photos: { before: string; after: string } | undefined;
    let photoIds: string[] = [];
    if (p.kind === 'promo') {
      const offer = pickOffer(p.offer_text, profile.offers ?? []);
      if (!offer) {
        return fail(
          task.task_id,
          "Tell me the offer and I'll make it a reel, like \"kids cuts $20 on weekdays\".",
          'no_offer',
          'no offer_text and no offers on the profile',
        );
      }
      source = offer;
    } else {
      const picked = await this.revealPhotos(task.customer_id, p.media_asset_ids);
      if (!picked) {
        return fail(
          task.task_id,
          'Send me a before photo and an after photo and I\'ll turn them into a reveal reel.',
          'not_enough_photos',
          'need two photos',
        );
      }
      try {
        photos = {
          before: await this.animated.preparePhoto(picked.before.bytes),
          after: await this.animated.preparePhoto(picked.after.bytes),
        };
      } catch (err) {
        return fail(task.task_id, "I couldn't read one of those photos. Could you send it again?", 'bad_photo', String(err));
      }
      photoIds = [picked.before.id, picked.after.id];
      source = p.offer_text ?? '';
    }

    const colors = toSvgColors(profile.brandColors ?? []);
    const theme: BrandTheme = {
      primary: colors[0] ?? '#2C3E50',
      secondary: colors[1],
      brandName: customer.businessName ?? undefined,
      style: (profile.visualStyle as BrandTheme['style']) ?? undefined,
    };
    const look = reelLook(theme);
    const ctx: SpecContext = {
      kind: p.kind,
      source,
      businessName: customer.businessName,
      businessType: profile.businessType,
      websiteUrl: profile.websiteUrl,
    };
    const brandContext = buildBrandContext(profile);

    let built: Awaited<ReturnType<typeof buildSpec>>;
    try {
      built = await buildSpec(this.llm, ctx, look, brandContext, task.customer_id);
    } catch (err) {
      return fail(task.task_id, "I couldn't make the words fit that reel. Try a shorter offer?", 'copy_failed', String(err));
    }
    if (built.problems.length) {
      this.log.log(`animated reel copy for ${task.customer_id} (${built.source}): ${built.problems.join('; ')}`);
    }

    let mp4: Buffer;
    try {
      const seed = await this.prisma.post.count({ where: { customerId: task.customer_id } });
      ({ mp4 } = await this.animated.render(built.layout, look, { photos, seed }));
    } catch (err) {
      return fail(task.task_id, "I hit a snag making your reel. I'll try again shortly.", 'render_failed', String(err), true);
    }

    const r2Key = `${task.customer_id}/${randomUUID()}/animated-reel.mp4`;
    await this.storage.put(r2Key, mp4, 'video/mp4');

    const screen = onScreenText(built.spec);
    const gen = await this.caption(task, profile, built.spec, screen, customer.businessName);
    const verdict = await this.moderation.screen({
      caption: `${gen.caption}\n${screen}`,
      hashtags: gen.hashtags,
      blackoutTopics: profile.blackoutTopics,
    });
    // Gate what a viewer reads: the caption, the hashtags and every word on screen.
    const risk = this.gate.classifyRisk(
      [gen.caption, gen.hashtags.map((h) => `#${h}`).join(' '), screen].filter(Boolean).join(' '),
    );
    const decision = this.gate.decide(customer.trustLevel, risk);

    const post = await this.prisma.post.create({
      data: {
        customerId: task.customer_id,
        archetype: p.kind === 'promo' ? 'promo' : 'behind_the_scenes',
        platform: p.platform,
        caption: gen.caption,
        altText: gen.alt_text ?? null,
        hashtags: gen.hashtags,
        mediaRefs: [r2Key],
        scheduledTime: p.scheduled_time ? new Date(p.scheduled_time) : null,
        riskLevel: risk,
        moderationState: verdict.passed ? 'passed' : 'blocked',
        approvalState: verdict.passed ? decision.approvalState : 'awaiting_owner',
        status: verdict.passed ? 'pending_approval' : 'draft',
      },
    });
    if (photoIds.length) {
      await this.prisma.mediaAsset.updateMany({ where: { id: { in: photoIds } }, data: { postId: post.id } });
    }
    await this.prisma.mediaAsset.create({
      data: {
        customerId: task.customer_id,
        postId: post.id,
        kind: 'video',
        source: 'assembled',
        r2Key,
        contentType: 'video/mp4',
        width: 1080,
        height: 1920,
      },
    });

    const what = p.kind === 'promo' ? 'promo reel' : 'before and after reel';
    const waitingAhead = await this.prisma.post.count({
      where: { customerId: task.customer_id, status: 'pending_approval', id: { not: post.id } },
    });
    if (!waitingAhead && verdict.passed) {
      // This text shows it, so it counts as presented (the stranded-draft
      // sweep would otherwise text it a second time).
      await this.prisma.post.update({ where: { id: post.id }, data: { presentedAt: new Date() } });
    }
    return ok(
      task.task_id,
      reelReadyText(what, this.storage.publicUrl(r2Key), waitingAhead),
      'pending_approval',
      {
        post_id: post.id,
        media_ref: r2Key,
        kind: p.kind,
        copy_source: built.source,
        bytes: mp4.length,
        on_screen: screen,
        waiting_ahead: waitingAhead,
      },
    );
  }

  /** The two photos for a reveal: the ones asked for, else the newest tagged before and after. */
  private async revealPhotos(
    customerId: string,
    ids: string[] | undefined,
  ): Promise<{ before: { id: string; bytes: Buffer }; after: { id: string; bytes: Buffer } } | null> {
    let before: { id: string; r2Key: string } | null = null;
    let after: { id: string; r2Key: string } | null = null;
    if (ids?.length === 2) {
      const rows = await this.prisma.mediaAsset.findMany({
        where: { id: { in: ids }, customerId, kind: 'image' },
        select: { id: true, r2Key: true },
      });
      before = rows.find((r) => r.id === ids[0]) ?? null;
      after = rows.find((r) => r.id === ids[1]) ?? null;
    } else {
      const newest = (subject: string) =>
        this.prisma.mediaAsset.findFirst({
          where: { customerId, kind: 'image', subject },
          orderBy: { createdAt: 'desc' },
          select: { id: true, r2Key: true },
        });
      [before, after] = await Promise.all([newest('before'), newest('after')]);
    }
    if (!before || !after || before.id === after.id) return null;
    const [b, a] = await Promise.all([this.storage.get(before.r2Key), this.storage.get(after.r2Key)]);
    if (!b || !a) return null;
    return { before: { id: before.id, bytes: b }, after: { id: after.id, bytes: a } };
  }

  /** The post caption. Polish, not the product: a model failure gets a plain caption. */
  private async caption(
    task: Extract<Task, { type: 'ANIMATED_REEL' }>,
    profile: Parameters<typeof buildBrandContext>[0],
    spec: AnimatedReelSpec,
    screen: string,
    businessName: string | null,
  ): Promise<{ caption: string; hashtags: string[]; alt_text?: string }> {
    try {
      return await this.llm.completeJson(
        {
          tier: 'voice',
          cachedContext: buildBrandContext(profile),
          prompt: [
            `Write one ${spec.kind === 'promo' ? 'promo' : 'before-and-after'} reel caption for ${task.payload.platform}.`,
            `The reel is an animated graphic. Its on-screen words: ${screen}`,
            'Use only the facts on screen and in the brand context; never add a price, date or claim.',
            playbookFor(task.payload.platform),
            'Return JSON: {"caption": string, "hashtags": string[], "alt_text": string}.',
            ALT_TEXT_RULE,
          ].join('\n'),
          maxTokens: 600,
          customerId: task.customer_id,
        },
        CaptionLlmOutput,
      );
    } catch (err) {
      this.log.warn(`animated reel caption failed for ${task.customer_id}: ${String(err)}`);
      const name = businessName ?? 'us';
      return spec.kind === 'promo'
        ? {
            caption: `${spec.headline}${spec.price ? ` for ${spec.price}` : ''} at ${name}. ${spec.details.join('. ')}`.trim(),
            hashtags: [],
            alt_text: `An animated promo from ${name}: ${screen}`,
          }
        : {
            caption: `Before and after at ${name} ✨`,
            hashtags: [],
            alt_text: `A before and after reveal from ${name}.`,
          };
    }
  }
}
