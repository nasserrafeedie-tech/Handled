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

  /**
   * A publish stamps publishStartedAt right before the platform call. If the
   * worker dies between the platform call and the DB write, the stamp is left
   * set on a still-scheduled/approved post. We do NOT re-publish it — it may
   * already be live, and a double post under the owner's name is the one thing
   * we never risk — we surface it. A real publish takes seconds, so a stamp this
   * old means the worker crashed mid-publish.
   */
  private static readonly PUBLISHING_STUCK_MINUTES = 15;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PublishQueueService,
  ) {}

  /**
   * Re-queue everything stranded. Returns what it found, so the caller can
   * log it and an operator can see whether this is firing constantly — a
   * sweep that keeps finding work means something upstream is broken.
   */
  async sweep(now = new Date()): Promise<{ requeued: number; stale: number; interrupted: number }> {
    const lateBefore = new Date(now.getTime() - ReconcileService.LATE_AFTER_MINUTES * 60_000);
    const horizon = new Date(now.getTime() - ReconcileService.LOOKBACK_HOURS * 3600_000);
    const publishingStuckBefore = new Date(
      now.getTime() - ReconcileService.PUBLISHING_STUCK_MINUTES * 60_000,
    );

    const stranded = await this.prisma.post.findMany({
      where: {
        // 'scheduled' is the normal stranded case; 'approved' catches an
        // autopilot post whose one best-effort SCHEDULE_POST emit failed — it
        // has a scheduledTime but nothing ever queued it, and no other sweep
        // looks at 'approved', so it would otherwise never publish.
        status: { in: ['scheduled', 'approved'] },
        scheduledTime: { lt: lateBefore, gte: horizon },
        // Only posts that were actually cleared to go. A post still waiting on
        // the owner is not stranded — it is waiting, which is correct. 'rejected'
        // is excluded here too (it is not 'not awaiting_owner'... it IS, so
        // exclude explicitly).
        approvalState: { notIn: ['awaiting_owner', 'rejected'] },
        moderationState: 'passed',
        customer: { status: 'active' },
        // Not one currently being published (claim stamped) — that is handled
        // by the interrupted sweep below, never re-queued.
        publishStartedAt: null,
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
        // rather than adding a second. And PUBLISH_DUE claims the row with an
        // atomic publishStartedAt compare-and-swap before the platform call, so
        // even if two runners fire at once only one publishes.
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
        status: { in: ['scheduled', 'approved'] },
        scheduledTime: { lt: horizon },
        approvalState: { notIn: ['awaiting_owner', 'rejected'] },
      },
      data: {
        status: 'failed',
        failureReason: '[stranded] never published; older than the reconciliation window',
      },
    });

    // A post stuck mid-publish (worker died after stamping the claim). Surface
    // it — never re-publish, since it may already be live. The operator verifies
    // on the platform and re-runs if it truly didn't post. Keyed on an old
    // publishStartedAt on a post that never reached 'published'.
    const interrupted = await this.prisma.post.updateMany({
      where: {
        status: { in: ['scheduled', 'approved'] },
        publishStartedAt: { not: null, lt: publishingStuckBefore },
      },
      data: {
        status: 'failed',
        failureReason:
          '[interrupted] publish was claimed but never confirmed — verify on the platform before re-publishing',
      },
    });

    if (requeued || stale.count || interrupted.count) {
      this.log.warn(
        `reconciliation: re-queued ${requeued}, wrote off ${stale.count} as too old, ` +
          `flagged ${interrupted.count} interrupted mid-publish`,
      );
    }
    return { requeued, stale: stale.count, interrupted: interrupted.count };
  }
}
