import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Task, type Result, CaptionLlmOutput } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { playbookFor, ALT_TEXT_RULE } from '../llm/playbook';
import { ModerationService } from '../guardrails/moderation.service';
import { PublishGateService } from '../guardrails/publish-gate.service';
import { GraphicsService } from '../graphics/graphics.service';
import type { BrandTheme } from '../graphics/slide-templates';
import { ReelService } from '../video/reel.service';
import { TaskHandler, ok, fail } from './handler.interface';

/**
 * ASSEMBLE_REEL (§7, Growth+). Take the owner's banked clips, cut them into a
 * branded vertical reel, and stage it as a normal post through the same
 * moderation → approval pipeline as everything else. Reels are the plan
 * differentiator: Starter gets photos and graphics; Growth and up get video.
 */
@Injectable()
export class AssembleReelHandler implements TaskHandler<'ASSEMBLE_REEL'> {
  readonly type = 'ASSEMBLE_REEL' as const;
  private readonly log = new Logger(AssembleReelHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reel: ReelService,
    private readonly graphics: GraphicsService,
    private readonly llm: LlmService,
    private readonly moderation: ModerationService,
    private readonly gate: PublishGateService,
  ) {}

  async handle(task: Extract<Task, { type: 'ASSEMBLE_REEL' }>): Promise<Result> {
    const [customer, profile] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: task.customer_id } }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
    ]);
    if (!customer || !profile) {
      return fail(task.task_id, 'I need your profile set up first.', 'no_brand_profile', task.customer_id);
    }

    // Plan gate — reels start at Growth.
    if (customer.planTier === 'starter') {
      return fail(
        task.task_id,
        'Reels are part of the Growth plan — reply UPGRADE and I\'ll send the details.',
        'plan_gate',
        `planTier=${customer.planTier}`,
      );
    }

    // Resolve clips: requested ids, else banked owner videos, oldest first.
    const clips = await this.prisma.mediaAsset.findMany({
      where: task.payload.media_asset_ids?.length
        ? { id: { in: task.payload.media_asset_ids }, customerId: task.customer_id }
        : {
            customerId: task.customer_id,
            kind: 'video',
            source: 'owner_upload',
            postId: null,
          },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    const mediaDir = process.env.MEDIA_DIR ?? join(__dirname, '..', '..', '..', 'media');
    const clipPaths = clips
      .map((c) => ({ asset: c, path: join(mediaDir, c.r2Key) }))
      .filter(({ asset, path }) => {
        const okFile = existsSync(path);
        if (!okFile) this.log.warn(`clip ${asset.id} has no local file at ${path} — skipped`);
        return okFile;
      });

    if (clipPaths.length < 2) {
      return fail(
        task.task_id,
        'I need at least two clips to cut a reel — film a couple of 5–10 second videos and send them over!',
        'not_enough_clips',
        `${clipPaths.length} usable clip(s)`,
        );
    }

    // Brand end card + hook, from the identity assigned at onboarding.
    const theme: BrandTheme = {
      primary: profile.brandColors?.[0] ?? '#2C3E50',
      secondary: profile.brandColors?.[1],
      brandName: customer.businessName ?? undefined,
      style: (profile.visualStyle as BrandTheme['style']) ?? undefined,
    };
    const endCardPng = this.graphics.renderSlide(
      {
        kind: 'cta',
        headline: customer.businessName ?? 'Come see us',
        body: 'We saved you a spot.',
        // The headline IS the brand name — a footer would print it twice.
        footer: '',
        variant: await this.prisma.post.count({ where: { customerId: task.customer_id } }),
      },
      theme,
    );

    let mp4: Buffer;
    try {
      mp4 = await this.reel.assemble({
        clipPaths: clipPaths.map((c) => c.path),
        hookText: task.payload.hook_text ?? defaultHook(customer.businessName),
        endCardPng,
        accentHex: profile.brandColors?.[1],
        fontPath: bundledFont(),
      });
    } catch (err) {
      return fail(
        task.task_id,
        "I hit a snag cutting your reel — I'll retry shortly.",
        'assembly_failed',
        err instanceof Error ? err.message : String(err),
        true,
      );
    }

    // Store the mp4 exactly like other assembled media.
    const batch = randomUUID();
    const r2Key = `${task.customer_id}/${batch}/reel.mp4`;
    mkdirSync(join(mediaDir, task.customer_id, batch), { recursive: true });
    writeFileSync(join(mediaDir, r2Key), mp4);

    // Caption via the same playbook-driven path as any other post.
    const gen = await this.llm.completeJson(
      {
        tier: 'bulk',
        cachedContext: buildBrandContext(profile),
        prompt: [
          `Write one behind_the_scenes reel caption for ${task.payload.platform}.`,
          'The video is real footage from the business, cut into a short reel.',
          playbookFor(task.payload.platform),
          'Return JSON: {"caption": string, "hashtags": string[], "alt_text": string}.',
          ALT_TEXT_RULE,
        ].join('\n'),
        maxTokens: 600,
      },
      CaptionLlmOutput,
    );

    const verdict = await this.moderation.screen({
      caption: gen.caption,
      hashtags: gen.hashtags,
      blackoutTopics: profile.blackoutTopics,
    });
    const risk = this.gate.classifyRisk(gen.caption);
    const decision = this.gate.decide(customer.trustLevel, risk);

    const post = await this.prisma.post.create({
      data: {
        customerId: task.customer_id,
        archetype: 'behind_the_scenes',
        platform: task.payload.platform,
        caption: gen.caption,
        altText: gen.alt_text ?? null,
        hashtags: gen.hashtags,
        mediaRefs: [r2Key],
        scheduledTime: task.payload.scheduled_time ? new Date(task.payload.scheduled_time) : null,
        riskLevel: risk,
        moderationState: verdict.passed ? 'passed' : 'blocked',
        approvalState: verdict.passed ? decision.approvalState : 'awaiting_owner',
        status: verdict.passed ? 'pending_approval' : 'draft',
      },
    });

    // Claim the clips + register the reel file.
    await this.prisma.mediaAsset.updateMany({
      where: { id: { in: clipPaths.map((c) => c.asset.id) } },
      data: { postId: post.id },
    });
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

    const base = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
    return ok(
      task.task_id,
      `Your reel is ready 🎬 (${clipPaths.length} clips) — watch it here: ${base}/media/${r2Key}\n\nReply “yes” to schedule it, or tell me what to change.`,
      'pending_approval',
      { post_id: post.id, media_ref: r2Key, clip_count: clipPaths.length, bytes: mp4.length },
    );
  }
}

function defaultHook(businessName: string | null): string {
  return businessName ? `A little peek inside ${businessName}` : 'Come behind the counter with us';
}

/** First bundled bold-ish TTF from the graphics fonts dir (src or dist). */
function bundledFont(): string | undefined {
  for (const dir of [
    join(__dirname, '..', 'graphics', 'fonts'),
    join(__dirname, '..', '..', '..', 'src', 'operator', 'graphics', 'fonts'),
  ]) {
    if (existsSync(dir)) {
      const bold = readdirSync(dir).find((f) => /bold/i.test(f) && f.endsWith('.ttf'));
      const any = readdirSync(dir).find((f) => f.endsWith('.ttf'));
      if (bold || any) return join(dir, (bold ?? any)!);
    }
  }
  return undefined;
}
