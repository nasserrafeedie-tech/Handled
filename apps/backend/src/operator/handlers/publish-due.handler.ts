import { Injectable, Logger } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PostForMeService } from '../publishing/post-for-me.service';
import {
  classifyPublishFailure,
  isRetryable,
} from '../publishing/publish-failure';
import { platformName } from '../publishing/platform-names';
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
    let failed = 0;
    const notices: { customer_id: string; message: string }[] = [];
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
        // Read the failure before reacting to it. An expired connection, a
        // caption the platform refused, and a rate limit all used to end the
        // same way: status='failed', nobody told, the owner finding out from
        // their own empty feed.
        const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
        const failure = classifyPublishFailure(
          err,
          platformName(post.platform),
          `${site}/connect?customer=${post.customerId}`,
        );
        this.log.warn(`publish failed for ${post.id} [${failure.kind}]: ${failure.detail}`);

        await this.prisma.post.update({
          where: { id: post.id },
          data: {
            // A transient failure goes back to scheduled so the reconciliation
            // sweep picks it up; only a settled failure is marked failed.
            status: isRetryable(failure.kind) ? 'scheduled' : 'failed',
            failureReason: `[${failure.kind}] ${failure.detail}`,
          },
        });

        // Reported, not sent. §3 keeps the Operator out of the owner's text
        // thread — the Concierge owns that conversation, so the caller does
        // the telling.
        if (failure.ownerMessage) {
          notices.push({ customer_id: post.customerId, message: failure.ownerMessage });
        }
        failed++;
      }
    }

    return ok(
      task.task_id,
      published ? `Posted ${published} update${published > 1 ? 's' : ''}.` : 'Nothing was due to post.',
      'done',
      { published, skipped, failed, notices },
    );
  }
}
