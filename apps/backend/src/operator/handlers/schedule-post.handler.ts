import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishQueueService } from '../../scheduler/publish-queue.service';
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
    const post = await this.prisma.post.findFirst({
      where: { id: task.payload.post_id, customerId: task.customer_id },
    });
    if (!post) {
      return fail(task.task_id, "I couldn't find that post to schedule.", 'post_not_found', task.payload.post_id);
    }
    if (post.moderationState !== 'passed') {
      return fail(task.task_id, "That post hasn't cleared review yet.", 'not_moderated', post.id);
    }
    // The owner's "yes" arrives on the Task itself — record it, then proceed.
    // Without it, an un-approved post can never reach the queue.
    const approved =
      post.approvalState !== 'awaiting_owner' || task.payload.owner_approved;
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

    return ok(task.task_id, `Scheduled for ${when.toLocaleString()}.`, 'done', {
      post_id: post.id,
      scheduled_time: when.toISOString(),
    });
  }
}
