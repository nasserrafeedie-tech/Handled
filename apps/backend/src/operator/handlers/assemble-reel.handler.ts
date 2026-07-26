import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { type Task, type Result, CaptionLlmOutput } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { tierHas } from '../tier-entitlements';
import { playbookFor, ALT_TEXT_RULE } from '../llm/playbook';
import { ModerationService } from '../guardrails/moderation.service';
import { PublishGateService } from '../guardrails/publish-gate.service';
import { GraphicsService } from '../graphics/graphics.service';
import type { BrandTheme } from '../graphics/slide-templates';
import { ReelService } from '../video/reel.service';
import { TranscriptionService } from '../video/transcription.service';
import { EdlService } from '../video/edl.service';
import { probeDuration } from '../video/probe';
import { probeMotion } from '../video/motion';
import { mapWordsToTimeline, edlDuration } from '../video/edl';
import { captionsToAss } from '../video/captions';
import { TaskHandler, ok, fail } from './handler.interface';
import { StorageService } from '../../common/storage.service';
import { resolveStrategy } from '../llm/vertical-playbook';
import { toSvgColors } from '../graphics/color.util';

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
    private readonly transcription: TranscriptionService,
    private readonly edl: EdlService,
    private readonly graphics: GraphicsService,
    private readonly llm: LlmService,
    private readonly moderation: ModerationService,
    private readonly gate: PublishGateService,
    private readonly storage: StorageService,
  ) {}

  async handle(task: Extract<Task, { type: 'ASSEMBLE_REEL' }>): Promise<Result> {
    const [customer, profile] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: task.customer_id } }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
    ]);
    if (!customer || !profile) {
      return fail(task.task_id, 'I need your profile set up first.', 'no_brand_profile', task.customer_id);
    }

    // Plan gate — reels are a Pro feature. Goes through the tier-entitlements
    // helper rather than naming a tier inline, so a future gate change happens
    // in one place and the concierge's copy can never contradict this refusal.
    if (!tierHas(customer.planTier, 'reel')) {
      return fail(
        task.task_id,
        'Reels are part of the Pro plan — reply UPGRADE and I\'ll send the details.',
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

    // Stage each banked clip on local disk for ffmpeg. The clips live in R2, and
    // this handler runs on the WORKER service — a different machine from the web
    // box that received the upload — so the worker's local media dir is empty.
    // storage.get reads local-then-R2, so we download each clip through it into
    // a private temp working dir, and clean the whole dir up in the finally below.
    const workDir = mkdtempSync(join(tmpdir(), `reel-${task.customer_id}-`));
    const clipPaths: { asset: (typeof clips)[number]; path: string }[] = [];
    for (const c of clips) {
      const bytes = await this.storage.get(c.r2Key);
      if (!bytes) {
        this.log.warn(`clip ${c.id} not found in storage at ${c.r2Key} — skipped`);
        continue;
      }
      const ext = c.r2Key.split('.').pop() || 'mov';
      const p = join(workDir, `${c.id}.${ext}`);
      writeFileSync(p, bytes);
      clipPaths.push({ asset: c, path: p });
    }

    if (clipPaths.length < 2) {
      rmSync(workDir, { recursive: true, force: true });
      return fail(
        task.task_id,
        'I need at least two clips to cut a reel — film a couple of 5–10 second videos and send them over!',
        'not_enough_clips',
        `${clipPaths.length} usable clip(s)`,
        );
    }

    try {

    // Brand end card + hook, from the identity assigned at onboarding.
    const theme: BrandTheme = {
      primary: toSvgColors(profile.brandColors ?? [])[0] ?? '#2C3E50',
      secondary: toSvgColors(profile.brandColors ?? [])[1],
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

    // Transcribe → decide the edit → caption it. Every step below degrades to
    // the plain in-order cut rather than failing: captions and smart trims are
    // the polish, the reel itself is the product (see transcription.service.ts).
    const paths = clipPaths.map((c) => c.path);
    const durations = await Promise.all(paths.map((p) => probeDuration(p)));
    const transcripts = await this.transcription.transcribeAll(paths);

    const defaultHook = task.payload.hook_text ?? resolveStrategy(profile).reel_hook;
    const edl = await this.edl.decide({
      clipDurations: durations,
      transcripts,
      defaultHook,
      brandContext: buildBrandContext(profile),
      customerId: task.customer_id,
    });

    // Dynamic cold-open (#1): the editor is transcript-blind, so measure the
    // PICTURE. Score each clip's motion and, if one clip has a moment that
    // clearly stands out from its baseline, open the reel on that ~1.2s window
    // (muted). Static talking-head footage has nothing that stands out, so it
    // gets no cold-open rather than a pointless flash. Best-effort: any failure
    // just means no cold-open.
    const coldOpen = await this.pickColdOpen(paths, durations);
    const offsetSecs = coldOpen ? coldOpen.duration : 0;
    if (coldOpen) {
      this.log.log(
        `cold-open: clip ${coldOpen.clipIndex} @ ${coldOpen.start.toFixed(1)}s ` +
          `for ${coldOpen.duration}s`,
      );
    }

    // Captions are timed against the FINISHED edit, not the source clips — a
    // word spoken 6s into clip 2 lands somewhere else entirely once the edit
    // reorders and trims. Skipping this remap still renders captions; they just
    // describe a different moment than the one on screen. `offsetSecs` pushes
    // them past the cold-open so they stay in sync with the audio.
    const captionsAss = captionsToAss(
      mapWordsToTimeline(edl, transcripts.map((t) => t.words)),
      {
        // Highlight the karaoke word in the brand's own colour: the accent
        // (second colour) when they have one, else the primary, so a brand with
        // a single colour still sees it — only a brand with no colours at all
        // falls back to the default. Captions read as unmistakably theirs.
        accentHex:
          toSvgColors(profile.brandColors ?? [])[1] ??
          toSvgColors(profile.brandColors ?? [])[0],
        brandStyle: theme.style,
        // The hook rides in the same subtitle file as the captions — libass
        // draws it, because the drawtext filter is absent from the ffmpeg build
        // that runs in production.
        hookText: edl.hook || defaultHook,
        offsetSecs,
      },
    );

    const font = bundledFont();
    let mp4: Buffer;
    try {
      mp4 = await this.reel.assemble({
        clipPaths: paths,
        edl,
        captionsAss,
        endCardPng,
        fontsDir: font?.dir,
        coldOpen,
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
    await this.storage.put(r2Key, mp4, 'video/mp4');

    // Caption via the same playbook-driven path as any other post. Like every
    // other step in this handler, the caption is POLISH — the rendered reel is
    // the product. So a malformed-JSON blip from the model must not throw away a
    // reel we already cut and stored: fall back to a plain brand-safe caption
    // and let the owner tweak it, exactly as they would any draft.
    let gen: (typeof CaptionLlmOutput)['_output'];
    try {
      gen = await this.llm.completeJson(
        {
          // Voice (Sonnet), not bulk (Haiku): the reel caption is customer-facing
          // and reels are a Pro feature, so it's worth the better model. Haiku was
          // also returning malformed JSON on this prompt often enough to trip the
          // fallback on every reel — Sonnet is far more reliable at strict JSON.
          tier: 'voice',
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
    } catch (err) {
      const name = customer.businessName ?? 'us';
      this.log.warn(
        `caption LLM failed for ${task.customer_id}, using fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      gen = {
        caption: `Behind the scenes at ${name} 🎬`,
        hashtags: [],
        alt_text: `A short behind-the-scenes reel from ${name}.`,
      };
    }

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

    return ok(
      task.task_id,
      `Your reel is ready 🎬 (${clipPaths.length} clips) — watch it here: ${this.storage.publicUrl(r2Key)}\n\nReply “yes” to schedule it, or tell me what to change.`,
      'pending_approval',
      {
        post_id: post.id,
        media_ref: r2Key,
        clip_count: clipPaths.length,
        bytes: mp4.length,
        // Recorded so a reel that came out silent or uncaptioned can be
        // diagnosed from the task log alone, without re-running the pipeline.
        seconds: Math.round(edlDuration(edl)),
        captioned: captionsAss.includes('Dialogue:'),
      },
    );
    } finally {
      // Always remove the staged clips — the render is done (or failed) and the
      // worker moves on to the next job; leaving temp video around fills disk.
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Choose the reel's dynamic cold-open, or nothing.
   *
   * Scores each clip's motion and takes the standout window — but only if it
   * clearly beats that clip's own baseline (ratio ≥ MIN_RATIO). Uniformly static
   * footage produces no standout and gets no cold-open, which is correct: a
   * silent flash of a still frame is worse than just starting the reel. Among
   * clips that DO have a standout, the most motion-heavy window wins. All
   * best-effort — a probe failure simply drops that clip from the running.
   */
  private async pickColdOpen(
    paths: string[],
    durations: number[],
  ): Promise<{ clipIndex: number; start: number; duration: number } | undefined> {
    const COLD_OPEN_SECS = 1.2;
    const MIN_RATIO = 1.5;

    const windows = await Promise.all(
      paths.map((p, i) =>
        (durations[i] ?? 0) >= COLD_OPEN_SECS + 0.3
          ? probeMotion(p, COLD_OPEN_SECS)
          : Promise.resolve(null),
      ),
    );

    let bestIdx = -1;
    let bestScore = -Infinity;
    windows.forEach((w, i) => {
      if (!w || w.ratio < MIN_RATIO) return;
      if (w.score > bestScore) {
        bestScore = w.score;
        bestIdx = i;
      }
    });
    if (bestIdx < 0) return undefined;

    const w = windows[bestIdx]!;
    const start = Math.min(w.start, Math.max(0, durations[bestIdx] - COLD_OPEN_SECS));
    return { clipIndex: bestIdx, start, duration: COLD_OPEN_SECS };
  }
}

/**
 * The bundled fonts: one bold-ish TTF for the drawtext hook, and the directory
 * itself so libass can resolve the caption font by family name. Both come from
 * the same place the graphics engine draws from, which is what keeps a reel
 * looking like the customer's other posts.
 */
function bundledFont(): { file: string; dir: string } | undefined {
  for (const dir of [
    join(__dirname, '..', 'graphics', 'fonts'),
    join(__dirname, '..', '..', '..', 'src', 'operator', 'graphics', 'fonts'),
  ]) {
    if (existsSync(dir)) {
      const bold = readdirSync(dir).find((f) => /bold/i.test(f) && f.endsWith('.ttf'));
      const any = readdirSync(dir).find((f) => f.endsWith('.ttf'));
      if (bold || any) return { file: join(dir, (bold ?? any)!), dir };
    }
  }
  return undefined;
}
