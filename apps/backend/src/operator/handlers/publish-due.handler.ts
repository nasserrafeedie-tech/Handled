import { Injectable, Logger } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PostForMeService } from '../publishing/post-for-me.service';
import { TaskHandler, ok } from './handler.interface';

/**
 * PUBLISH_DUE (§7, cron). Publish everything due via Post for Me. Re-checks the
 * §8 gate at publish time (nothing un-approved or un-moderated goes out) and is
 * idempotent — an already-published post is skipped. Transient failures are
 * marked failed and left for BullMQ retry.
 */
@Injectable()
export class PublishDueHandler implements TaskHandler<'PUBLISH_DUE'> {
  readonly type = 'PUBLISH_DUE' as const;
  private readonly log = new Logger(PublishDueHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly postForMe: PostForMeService,
  ) {}

  /**
   * mediaRefs store R2 keys ("owner/<customer>/<task>"), but the posting API
   * needs fetchable URLs. Resolve through R2_PUBLIC_BASE_URL; anything that
   * can't be resolved is dropped with a warning rather than sent — a bare
   * storage key in the payload would fail the whole publish.
   */
  private resolveMediaUrls(postId: string, refs: string[]): string[] {
    const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    const urls: string[] = [];
    for (const ref of refs) {
      if (/^https?:\/\//.test(ref)) urls.push(ref);
      else if (base) urls.push(`${base}/${ref}`);
      else this.log.warn(`post ${postId}: dropping media ref "${ref}" (no R2_PUBLIC_BASE_URL)`);
    }
    return urls;
  }

  async handle(task: Extract<Task, { type: 'PUBLISH_DUE' }>): Promise<Result> {
    const dueBefore = task.payload.due_before
      ? new Date(task.payload.due_before)
      : new Date();

    const posts = await this.prisma.post.findMany({
      where: task.payload.post_id
        ? { id: task.payload.post_id, customerId: task.customer_id }
        : {
            customerId: task.customer_id,
            status: 'scheduled',
            scheduledTime: { lte: dueBefore },
          },
      include: { customer: true },
    });

    let published = 0;
    let skipped = 0;
    for (const post of posts) {
      // §8 publish-time gate: never publish un-approved / un-moderated / paused.
      const blocked =
        post.customer.status === 'paused' ||
        post.moderationState !== 'passed' ||
        post.approvalState === 'awaiting_owner' ||
        post.status === 'published';
      if (blocked) {
        skipped++;
        continue;
      }

      const account = await this.prisma.connectedAccount.findFirst({
        where: { customerId: post.customerId, platform: post.platform, revoked: false },
      });
      if (!account?.postForMeRef) {
        skipped++;
        continue;
      }

      try {
        const outcome = await this.postForMe.publish({
          platform: post.platform,
          postForMeRef: account.postForMeRef,
          caption: post.caption ?? '',
          hashtags: post.hashtags,
          mediaUrls: this.resolveMediaUrls(post.id, post.mediaRefs),
          // Instagram and TikTok both require model-made imagery to be
          // declared. Undisclosed AI content is a risk to the owner's account,
          // not ours, so this travels with every publish.
          aiGenerated: post.aiGeneratedMedia,
        });
        await this.prisma.post.update({
          where: { id: post.id },
          data: { status: 'published', externalPostId: outcome.externalPostId },
        });
        published++;
      } catch (err) {
        this.log.warn(`publish failed for ${post.id}: ${String(err)}`);
        await this.prisma.post.update({
          where: { id: post.id },
          data: { status: 'failed', failureReason: String(err) },
        });
      }
    }

    return ok(
      task.task_id,
      published ? `Posted ${published} update${published > 1 ? 's' : ''}.` : 'Nothing was due to post.',
      'done',
      { published, skipped },
    );
  }
}
