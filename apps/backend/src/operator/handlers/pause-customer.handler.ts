import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishQueueService } from '../../scheduler/publish-queue.service';
import { TaskHandler, ok } from './handler.interface';

/**
 * PAUSE_CUSTOMER — the §8 kill switch. Owner texts STOP/pause → all scheduled
 * publishing halts instantly. Must be dead simple and reliable: flip status and
 * drain the queue. `resume` reverses it.
 *
 * WHY a pause was taken is stored with it (pausedReason), because each one
 * comes undone a different way: an owner STOP lifts when the owner texts
 * START, a billing pause lifts when Stripe says they've paid, and an admin or
 * moderation pause only lifts from the admin side. Without the reason, a
 * cancelled customer could text "start" and get free service, and an owner
 * who texted STOP could never get back on at all.
 */
/** Marks a post the pause took off the schedule, so a resume can bring it back. */
export const PAUSE_MARK = 'paused: taken off the schedule by an account pause';

@Injectable()
export class PauseCustomerHandler implements TaskHandler<'PAUSE_CUSTOMER'> {
  readonly type = 'PAUSE_CUSTOMER' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PublishQueueService,
  ) {}

  async handle(task: Extract<Task, { type: 'PAUSE_CUSTOMER' }>): Promise<Result> {
    // Texts held for quiet hours were written for the account as it was. A
    // Friday recap saying "I've got the feed" must not land after the plan
    // ended, nor a "posts paused" notice after they're back on. The notice
    // about this change is sent after this runs, so it is kept.
    await this.prisma.queuedText.deleteMany({ where: { customerId: task.customer_id, sentAt: null } });

    if (task.payload.resume) {
      // Back to where they were: live if the interview was finished, else
      // mid-interview. Flipping a half-onboarded customer straight to 'active'
      // would let the weekly planner write posts from an empty profile.
      const profile = await this.prisma.brandProfile.findUnique({
        where: { customerId: task.customer_id },
        select: { onboardingComplete: true },
      });
      await this.prisma.customer.update({
        where: { id: task.customer_id },
        data: {
          status: profile?.onboardingComplete ? 'active' : 'onboarding',
          pausedReason: null,
        },
      });
      // Posts the pause took off the schedule that are still ahead come back
      // as drafts for another look. Before this, "I'll plan your next posts"
      // left the owner with nothing until the next weekly plan, a week or more
      // out, because the week they'd approved had been cancelled.
      const restored = await this.prisma.post.updateMany({
        where: {
          customerId: task.customer_id,
          status: 'cancelled',
          failureReason: PAUSE_MARK,
          scheduledTime: { gt: new Date(Date.now() + 30 * 60_000) },
        },
        data: {
          status: 'pending_approval',
          approvalState: 'awaiting_owner',
          failureReason: null,
          publishStartedAt: null,
          presentedAt: null,
        },
      });
      const back = restored.count;
      const waiting = await this.prisma.post.count({
        where: { customerId: task.customer_id, status: 'pending_approval' },
      });
      return ok(
        task.task_id,
        !profile?.onboardingComplete
          ? "You're back on. Let's pick up where we left off."
          : back > 0
            ? `You're back on. The ${back === 1 ? 'post' : `${back} posts`} I had lined up ${back === 1 ? 'is' : 'are'} ready again for a quick look.`
            : waiting > 0
              ? "You're back on. Here's where we left off."
              : "You're back on. I'll plan your next posts and send them over for a look.",
        'done',
        { restored_posts: back, waiting_posts: waiting },
      );
    }

    const removed = await this.queue.cancelAllForCustomer(task.customer_id);
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: task.customer_id },
        data: { status: 'paused', pausedReason: task.payload.reason },
      }),
      this.prisma.post.updateMany({
        where: { customerId: task.customer_id, status: 'scheduled' },
        data: { status: 'cancelled', failureReason: PAUSE_MARK },
      }),
    ]);

    return ok(
      task.task_id,
      task.payload.reason === 'owner_stop'
        ? "Done, I've paused everything and you won't hear from me. Nothing will post. Text START any time to pick back up."
        : "Done — I've paused everything. Nothing will post until you say go.",
      'done',
      { cancelled_jobs: removed },
    );
  }
}
