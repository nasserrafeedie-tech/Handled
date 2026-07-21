import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';
import { LlmService } from '../llm/llm.service';
import { ImageGenService } from '../graphics/image-gen.service';
import {
  buildImagePrompt,
  claimsSpecificPlace,
  stripOwnershipClaims,
  subjectInstruction,
  type ImageBrief,
} from '../graphics/image-prompt';
import { TaskHandler, ok, fail } from './handler.interface';
import { z } from 'zod';

/** Tiers that include generated photography. Starter gets graphics only. */
const TIERS_WITH_IMAGE_GEN = new Set(['growth', 'pro', 'premium']);

/** What the model is allowed to hand back when picking a subject. */
const SubjectOutput = z.object({ subject: z.string().min(1).max(200) });

/**
 * GENERATE_IMAGE. Makes a photograph for a post that has no owner photo.
 *
 * Three gates before a single token is spent, in order of how much they cost
 * to check: the plan tier, the owner's own opt-in, and whether a real photo is
 * already attached. The last one matters most — §7 is "owner photo > AI", and
 * a generated image that displaces a photo the owner actually sent is a
 * downgrade dressed up as a feature.
 */
@Injectable()
export class GenerateImageHandler implements TaskHandler<'GENERATE_IMAGE'> {
  readonly type = 'GENERATE_IMAGE' as const;
  private readonly log = new Logger(GenerateImageHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly images: ImageGenService,
    private readonly storage: StorageService,
  ) {}

  async handle(task: Extract<Task, { type: 'GENERATE_IMAGE' }>): Promise<Result> {
    const [customer, profile, post] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: task.customer_id } }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
      this.prisma.post.findUnique({ where: { id: task.payload.post_id } }),
    ]);

    if (!customer || !post) {
      return fail(task.task_id, 'I lost track of that post.', 'not_found',
        `customer/post missing for ${task.payload.post_id}`);
    }
    if (!TIERS_WITH_IMAGE_GEN.has(customer.planTier)) {
      return fail(task.task_id,
        "Making photos is part of the Growth plan — reply UPGRADE and I'll send the details.",
        'tier_not_eligible', `planTier=${customer.planTier}`);
    }
    if (!customer.aiImagesOptIn) {
      return fail(task.task_id,
        "I can make photos for you, but I'd want your OK first — want me to?",
        'not_opted_in', `${task.customer_id} has not opted in`);
    }
    // A photo the owner sent always wins. Checked here as well as by the
    // caller, because this task can be re-emitted after a photo has landed.
    if (post.mediaRefs.length > 0) {
      return ok(task.task_id, 'That post already has your photo on it.', 'done',
        { skipped: 'owner_media_present' });
    }
    if (!this.images.configured) {
      return fail(task.task_id, "I can't make photos just now.", 'not_configured',
        'FAL_API_KEY not set');
    }

    const brief: ImageBrief = {
      businessType: profile?.businessType ?? 'local business',
      visualStyle: profile?.visualStyle,
      caption: post.caption,
      brandColors: profile?.brandColors ?? [],
    };

    // Ask for a subject, then treat the answer as untrusted. A model asked for
    // a subject for a coffee shop will write "our storefront at golden hour"
    // given half a chance, and that is exactly the image we must not make.
    let subject: string;
    try {
      const picked = await this.llm.completeJson(
        {
          tier: 'bulk',
          // No brand context: picking a subject needs the kind of business, not
          // its name, and the name is the one thing that must not reach a
          // prompt that ends up describing an image.
          cachedContext: '',
          prompt: subjectInstruction(brief),
          maxTokens: 120,
        },
        SubjectOutput,
      );
      subject = picked.subject.trim();
    } catch (e) {
      return fail(task.task_id, "I couldn't picture that one — I'll ask you for a photo instead.",
        'subject_failed', String(e), true);
    }

    const cleaned = stripOwnershipClaims(subject);
    if (!cleaned || claimsSpecificPlace(cleaned)) {
      // Refuse rather than repair further. An image that claims to be their
      // premises is the one outcome this whole feature must not produce, and a
      // shot-list request costs the owner far less than that.
      this.log.warn(
        `rejected image subject for ${task.customer_id}: "${subject}" claims a specific place`,
      );
      return fail(task.task_id,
        "I'd rather use a real photo for this one — could you send me a quick shot?",
        'subject_claimed_premises', `subject="${subject}"`, true);
    }

    const prompt = buildImagePrompt(brief, cleaned);

    let image;
    try {
      image = await this.images.generate(prompt, { aspect: task.payload.aspect });
    } catch (e) {
      return fail(task.task_id,
        "I couldn't make that photo — could you send me one instead?",
        'generation_failed', String(e), true);
    }

    const r2Key = `${task.customer_id}/generated/${randomUUID()}.${image.ext}`;
    await this.storage.put(r2Key, image.bytes, image.contentType);
    await this.prisma.mediaAsset.create({
      data: {
        customerId: task.customer_id,
        postId: post.id,
        kind: 'image',
        source: 'ai_generated',
        r2Key,
        contentType: image.contentType,
      },
    });

    // Attach it and mark the post. Approval is forced back on regardless of
    // trust level: a generated image is a claim about the business, and the
    // owner sees every one before anybody else does.
    await this.prisma.post.update({
      where: { id: post.id },
      data: {
        mediaRefs: [r2Key],
        aiGeneratedMedia: true,
        approvalState: 'awaiting_owner',
      },
    });

    this.log.log(`generated image for post ${post.id}: "${cleaned}"`);
    return ok(task.task_id,
      "I made a photo to go with this one — have a look before it goes out.",
      'done',
      { media_ref: r2Key, subject: cleaned });
  }
}
