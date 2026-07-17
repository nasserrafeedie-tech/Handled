import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Task } from '@smm/contracts';
import { REDIS_CONNECTION } from './redis.provider';
import { PUBLISH_QUEUE, type PublishJobData } from './queue.constants';
import { TaskBus } from '../tasks/task-bus.service';

/**
 * Consumes the publish queue. When a post's scheduled time arrives, the job
 * fires and we emit a PUBLISH_DUE Task for that one post through the TaskBus —
 * so publishing goes through the same validated, logged, guardrailed path as
 * everything else (§8: "nothing publishes without tracing to a Task").
 *
 * BullMQ handles the retry/backoff; a thrown error here re-queues the job.
 */
@Injectable()
export class PublishWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PublishWorker.name);
  private worker?: Worker<PublishJobData>;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly bus: TaskBus,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<PublishJobData>(
      PUBLISH_QUEUE,
      async (job) => {
        const task: Task = {
          task_id: randomUUID(),
          customer_id: job.data.customerId,
          type: 'PUBLISH_DUE',
          payload: { post_id: job.data.postId },
          requires_approval: false,
          created_by: 'cron',
          created_at: new Date().toISOString(),
        };
        const result = await this.bus.emit(task);
        if (result.status === 'failed' && result.error?.retryable) {
          throw new Error(result.error.message); // let BullMQ retry
        }
      },
      { connection: this.connection, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) =>
      this.log.warn(`publish job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
