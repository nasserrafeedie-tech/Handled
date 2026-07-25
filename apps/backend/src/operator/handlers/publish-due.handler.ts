import { Injectable, Logger } from '@nestjs/common';
import { type Task, type Result, type Platform } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PostForMeService } from '../publishing/post-for-me.service';
import { GoogleBusinessService } from '../publishing/google-business.service';
import { TokenCryptoService } from '../security/token-crypto.service';
import {
  classifyPublishFailure,
  isRetryable,
} from '../publishing/publish-failure';
import { platformName } from '../publishing/platform-names';
import { TaskHandler, ok } from './handler.interface';

/** The post fields the publish-time gate reads. */
export interface PublishGateInput {
  status: string;
  moderationState: string;
  approvalState: string;
  customer: { status: string };
}

/**
 * §8 publish-time gate: may this post go out right now?
 *
 * This is the last line of defence before something publishes under a
 * customer's name, so it fails toward NOT publishing. A post is blocked if the
 * account is paused, if it did not pass moderation, if it is still waiting on
 * (or was refused by) the owner, or if it was already cancelled, failed, or
 * published. Anything the query might hand us that is not cleanly "ready to go"
 * is held, not sent.
 */
export function isBlockedFromPublishing(post: PublishGateInput): boolean {
  return (
    post.customer.status === 'paused' ||
    post.moderationState !== 'passed' ||
    post.approvalState === 'awaiting_owner' ||
    post.approvalState === 'rejected' ||
    post.status === 'cancelled' ||
    post.status === 'failed' ||
    post.status === 'publishing' ||
    post.status === 'published'
  );
}

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
    private readonly google: GoogleBusinessService,
    private readonly crypto: TokenCryptoService,
  ) {}

  /**
   * Publish through whichever backend a platform needs. Google Business Profile
   * is a direct Google integration (Post for Me has no Google support): it posts
   * a local post on the connected location, minting a fresh access token from
   * the stored refresh token. Everything else goes through Post for Me. Both
   * return the same shape, so the caller records the result identically.
   */
  private async publishTo(
    account: { platform: string; postForMeRef: string | null; refreshTokenEnc: string | null },
    post: { caption: string | null; hashtags: string[]; aiGeneratedMedia: boolean },
    mediaUrls: string[],
  ): Promise<{ externalPostId: string }> {
    if (account.platform === 'google_business') {
      if (!account.refreshTokenEnc || !account.postForMeRef) {
        throw new Error('google_business connection is missing its token or location');
      }
      const caption = [post.caption ?? '', post.hashtags.map((h) => `#${h}`).join(' ')]
        .filter(Boolean)
        .join('\n\n');
      return this.google.publish({
        locationName: account.postForMeRef,
        refreshToken: this.crypto.decrypt(account.refreshTokenEnc),
        caption,
        // A local post takes one photo, not a carousel — the first resolves.
        mediaUrl: mediaUrls[0],
      });
    }
    return this.postForMe.publish({
      platform: account.platform as Platform,
      postForMeRef: account.postForMeRef as string,
      caption: post.caption ?? '',
      hashtags: post.hashtags,
      mediaUrls,
      aiGenerated: post.aiGeneratedMedia,
    });
  }

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
      // §8 publish-time gate — the last line that stops something going out
      // under a customer's name. Extracted to isBlockedFromPublishing so it can
      // be tested directly, since the query above (the post_id branch) fetches
      // by id with no status filter, so a stray publish-now on a cancelled /
      // failed / rejected post reaches here.
      if (isBlockedFromPublishing(post)) {
        skipped++;
        continue;
      }

      // Atomic claim BEFORE the platform call — the guard against double-posting
      // under the owner's name. Three producers can emit PUBLISH_DUE for the same
      // due post in the same minute (per-post job, hourly sweep, reconciler); a
      // read-then-publish lets both win the race. This compare-and-swap moves the
      // row scheduled/approved → publishing and only the winner gets count===1;
      // every other runner sees 0 and skips. On any failure below we move it back
      // off 'publishing' so it is never stranded by the claim itself.
      const claim = await this.prisma.post.updateMany({
        where: { id: post.id, status: { in: ['scheduled', 'approved'] } },
        data: { status: 'publishing' },
      });
      if (claim.count === 0) {
        // Someone else claimed it (or it moved out of a publishable state
        // between the load and here). Not ours to publish.
        skipped++;
        continue;
      }

      const account = await this.prisma.connectedAccount.findFirst({
        where: { customerId: post.customerId, platform: post.platform, revoked: false },
      });
      if (!account?.postForMeRef) {
        // Release the claim so a later run (once an account is connected) can
        // pick it up, rather than leaving it stuck in 'publishing'.
        await this.prisma.post.update({
          where: { id: post.id },
          data: { status: 'scheduled' },
        });
        skipped++;
        continue;
      }

      // A post that was BUILT with media (a carousel, a generated image, an
      // owner photo) must not silently go out as a bare caption. If every ref
      // dropped — almost always a missing/misconfigured R2_PUBLIC_BASE_URL —
      // publishing text-only would make the flagship feature vanish with
      // nothing surfaced. Fail loudly instead, so it's caught, not shipped.
      const mediaUrls = this.resolveMediaUrls(post.id, post.mediaRefs);
      if (post.mediaRefs.length > 0 && mediaUrls.length === 0) {
        this.log.error(
          `post ${post.id}: ${post.mediaRefs.length} media ref(s) but none ` +
            'resolved to a URL — refusing to publish it caption-only. Check ' +
            'R2_PUBLIC_BASE_URL.',
        );
        await this.prisma.post.update({
          where: { id: post.id },
          data: {
            status: 'failed',
            failureReason:
              'media could not be resolved to a public URL (R2_PUBLIC_BASE_URL?) — not published as text-only',
          },
        });
        failed++;
        continue;
      }

      try {
        // Routed by platform: Google Business Profile posts directly to Google,
        // everything else through Post for Me. AI-made imagery is declared on
        // the Post for Me path (Instagram/TikTok require it); a Google local
        // post has no such field.
        const outcome = await this.publishTo(account, post, mediaUrls);
        await this.prisma.post.update({
          where: { id: post.id },
          data: {
            status: 'published',
            externalPostId: outcome.externalPostId,
            publishedAt: new Date(),
          },
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
