import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishQueueService } from '../../scheduler/publish-queue.service';
import { formatInZone } from '../../common/time';
import { TaskHandler, ok, fail } from './handler.interface';

/**
 * SCHEDULE_POST (§7/§8). Only an approved, moderation-passed post may be
 * enqueued. The gate was applied at draft time; we re-check here so nothing
 * un-approved ever reaches the publish queue.
 */
@Injectable()
export class SchedulePostHandler implements TaskHandler<'SCHEDULE_POST'> {
  readonly type = 'SCHEDULE_POST' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PublishQueueService,
  ) {}

  async handle(task: Extract<Task, { type: 'SCHEDULE_POST' }>): Promise<Result> {
    const [post, customer] = await Promise.all([
      this.prisma.post.findFirst({
        where: { id: task.payload.post_id, customerId: task.customer_id },
      }),
      this.prisma.customer.findUnique({
        where: { id: task.customer_id },
        select: { timezone: true },
      }),
    ]);
    if (!post) {
      return fail(task.task_id, "I couldn't find that post to schedule.", 'post_not_found', task.payload.post_id);
    }
    // A post in a terminal state is not ours to re-schedule. Without this a
    // stray SCHEDULE_POST (a retry, a duplicate "yes", a re-run) would rewind a
    // published/cancelled/failed post to 'scheduled' and the next queue fire
    // would re-publish or un-cancel it.
    if (
      post.status === 'published' ||
      post.status === 'publishing' ||
      post.status === 'cancelled' ||
      post.status === 'failed'
    ) {
      return fail(
        task.task_id,
        "That post isn't in a state I can schedule.",
        'not_schedulable',
        `${post.id} is ${post.status}`,
      );
    }
    if (post.moderationState !== 'passed') {
      return fail(task.task_id, "That post hasn't cleared review yet.", 'not_moderated', post.id);
    }
    // What may be scheduled, stated as an allow-list rather than "anything that
    // isn't awaiting_owner" — the old test let a REJECTED post through
    // ('rejected' !== 'awaiting_owner') and even promoted it back to approved.
    // A rejected post is one the owner (or a cancel) explicitly killed; it never
    // schedules, and owner_approved must not resurrect it.
    if (post.approvalState === 'rejected') {
      return fail(task.task_id, 'That post was cancelled, so I won\'t schedule it.', 'post_rejected', post.id);
    }
    const approved =
      post.approvalState === 'approved' ||
      post.approvalState === 'not_required' ||
      (post.approvalState === 'awaiting_owner' && Boolean(task.payload.owner_approved));
    if (!approved) {
      return fail(task.task_id, 'That post still needs your OK first.', 'awaiting_approval', post.id);
    }

    const when = new Date(task.payload.scheduled_time);
    await this.prisma.post.update({
      where: { id: post.id },
      data: {
        scheduledTime: when,
        status: 'scheduled',
        ...(task.payload.owner_approved
          ? { approvalState: 'approved' as const }
          : {}),
      },
    });
    await this.queue.schedule({ postId: post.id, customerId: task.customer_id }, when);

    // Always quote the time back in the owner's own timezone — the server's
    // locale is irrelevant to a shop owner reading this on their phone.
    const label = formatInZone(when, customer?.timezone ?? 'America/Los_Angeles');
    return ok(task.task_id, `Scheduled for ${label}.`, 'done', {
      post_id: post.id,
      scheduled_time: when.toISOString(),
    });
  }
}
