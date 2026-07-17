import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishQueueService } from '../../scheduler/publish-queue.service';
import { TaskHandler, ok } from './handler.interface';

/**
 * PAUSE_CUSTOMER — the §8 kill switch. Owner texts STOP/pause → all scheduled
 * publishing halts instantly. Must be dead simple and reliable: flip status and
 * drain the queue. `resume` reverses it.
 */
@Injectable()
export class PauseCustomerHandler implements TaskHandler<'PAUSE_CUSTOMER'> {
  readonly type = 'PAUSE_CUSTOMER' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PublishQueueService,
  ) {}

  async handle(task: Extract<Task, { type: 'PAUSE_CUSTOMER' }>): Promise<Result> {
    if (task.payload.resume) {
      await this.prisma.customer.update({
        where: { id: task.customer_id },
        data: { status: 'active' },
      });
      return ok(task.task_id, "You're back on — I'll resume posting as planned.");
    }

    const removed = await this.queue.cancelAllForCustomer(task.customer_id);
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: task.customer_id },
        data: { status: 'paused' },
      }),
      this.prisma.post.updateMany({
        where: { customerId: task.customer_id, status: 'scheduled' },
        data: { status: 'cancelled' },
      }),
    ]);

    return ok(
      task.task_id,
      "Done — I've paused everything. Nothing will post until you say go.",
      'done',
      { cancelled_jobs: removed },
    );
  }
}
