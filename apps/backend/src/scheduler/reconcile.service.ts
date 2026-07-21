import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PublishQueueService } from './publish-queue.service';

/**
 * Catching posts that quietly never went out.
 *
 * Scheduling relies on a Redis-backed job firing at the right minute. Most of
 * the time it does. But a job can be lost — Redis evicted under memory
 * pressure, the worker restarted mid-window, a deploy landing at the wrong
 * second — and when that happens the post just sits there, approved and
 * scheduled and past due, with nothing left to wake it.
 *
 * Nothing noticed. The owner approved a post, it never appeared, and the first
 * signal was their own empty feed. So this is the backstop: a periodic sweep
 * for anything whose moment has passed, re-queued if it can still go out and
 * surfaced if it cannot.
 *
 * The idea is borrowed from a scheduler that reached the same conclusion the
 * hard way — a durable queue still needs a reconciliation loop, because
 * "the job is gone" is indistinguishable from "the job hasn't fired yet".
 */
@Injectable()
export class ReconcileService {
  private readonly log = new Logger(ReconcileService.name);

  /**
   * How far back to look. Long enough to cover a weekend outage, short enough
   * that we are not re-publishing something so old it has stopped being true —
   * a Tuesday lunch special should not appear on Friday.
   */
  private static readonly LOOKBACK_HOURS = 48;

  /** Grace period before a post counts as late, not just in flight. */
  private static readonly LATE_AFTER_MINUTES = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PublishQueueService,
  ) {}

  /**
   * Re-queue everything stranded. Returns what it found, so the caller can
   * log it and an operator can see whether this is firing constantly — a
   * sweep that keeps finding work means something upstream is broken.
   */
  async sweep(now = new Date()): Promise<{ requeued: number; stale: number }> {
    const lateBefore = new Date(now.getTime() - ReconcileService.LATE_AFTER_MINUTES * 60_000);
    const horizon = new Date(now.getTime() - ReconcileService.LOOKBACK_HOURS * 3600_000);

    const stranded = await this.prisma.post.findMany({
      where: {
        status: 'scheduled',
        scheduledTime: { lt: lateBefore, gte: horizon },
        // Only posts that were actually cleared to go. A post still waiting on
        // the owner is not stranded — it is waiting, which is correct.
        approvalState: { not: 'awaiting_owner' },
        moderationState: 'passed',
        customer: { status: 'active' },
      },
      select: { id: true, customerId: true, scheduledTime: true },
      take: 200,
    });

    let requeued = 0;
    for (const post of stranded) {
      try {
        // Publish now rather than at the original time, which has passed.
        //
        // Two things stop this from double-posting. The job id is derived from
        // the post id, so scheduling replaces any job that does still exist
        // rather than adding a second. And if a publish were somehow already in
        // flight, PUBLISH_DUE re-reads the post and skips anything already
        // marked published — the guard that makes the whole path idempotent.
        await this.queue.schedule(
          { postId: post.id, customerId: post.customerId },
          now,
        );
        requeued++;
      } catch (e) {
        this.log.warn(`could not re-queue ${post.id}: ${String(e)}`);
      }
    }

    // Anything older than the lookback is not worth publishing late. Mark it
    // so it stops being invisible: a post that silently never ran is worse
    // than one recorded as missed.
    const stale = await this.prisma.post.updateMany({
      where: {
        status: 'scheduled',
        scheduledTime: { lt: horizon },
        approvalState: { not: 'awaiting_owner' },
      },
      data: {
        status: 'failed',
        failureReason: '[stranded] never published; older than the reconciliation window',
      },
    });

    if (requeued || stale.count) {
      this.log.warn(
        `reconciliation: re-queued ${requeued}, wrote off ${stale.count} as too old`,
      );
    }
    return { requeued, stale: stale.count };
  }
}
