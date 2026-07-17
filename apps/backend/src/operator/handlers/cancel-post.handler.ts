import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishQueueService } from '../../scheduler/publish-queue.service';
import { TaskHandler, ok, fail } from './handler.interface';

/** CANCEL_POST — owner said "don't post that". Remove from queue + mark cancelled. */
@Injectable()
export class CancelPostHandler implements TaskHandler<'CANCEL_POST'> {
  readonly type = 'CANCEL_POST' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PublishQueueService,
  ) {}

  async handle(task: Extract<Task, { type: 'CANCEL_POST' }>): Promise<Result> {
    const post = await this.prisma.post.findFirst({
      where: { id: task.payload.post_id, customerId: task.customer_id },
    });
    if (!post) {
      return fail(task.task_id, "I couldn't find that post.", 'post_not_found', task.payload.post_id);
    }
    if (post.status === 'published') {
      return fail(
        task.task_id,
        "That one already went live, so I can't pull it from here.",
        'already_published',
        post.id,
      );
    }

    await this.queue.cancel(post.id);
    await this.prisma.post.update({
      where: { id: post.id },
      data: { status: 'cancelled', approvalState: 'rejected', failureReason: task.payload.reason ?? null },
    });
    return ok(task.task_id, "Done — I won't post that one.");
  }
}
