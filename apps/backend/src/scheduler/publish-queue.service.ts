import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from './redis.provider';
import {
  PUBLISH_QUEUE,
  publishJobId,
  type PublishJobData,
} from './queue.constants';

/**
 * BullMQ-backed scheduler for publishing (§2 "the heart of the scheduler").
 * SCHEDULE_POST enqueues here with a delay to the post's scheduled_time;
 * PAUSE_CUSTOMER (§8 kill switch) removes a customer's pending jobs instantly.
 */
@Injectable()
export class PublishQueueService implements OnModuleDestroy {
  private readonly log = new Logger(PublishQueueService.name);
  private readonly queue: Queue<PublishJobData>;

  constructor(@Inject(REDIS_CONNECTION) connection: Redis) {
    this.queue = new Queue<PublishJobData>(PUBLISH_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
  }

  /** Idempotent enqueue: same postId → same jobId, so re-scheduling replaces. */
  async schedule(data: PublishJobData, when: Date): Promise<void> {
    const delay = Math.max(0, when.getTime() - Date.now());
    const jobId = publishJobId(data.postId);
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add('publish', data, { delay, jobId });
    this.log.log(`scheduled ${jobId} in ${Math.round(delay / 1000)}s`);
  }

  async cancel(postId: string): Promise<void> {
    await this.queue.remove(publishJobId(postId)).catch(() => undefined);
  }

  /** §8 kill switch — drop every pending publish for a customer. */
  async cancelAllForCustomer(customerId: string): Promise<number> {
    const jobs = await this.queue.getJobs(['delayed', 'waiting', 'paused']);
    let removed = 0;
    for (const job of jobs) {
      if (job?.data.customerId === customerId) {
        await job.remove();
        removed++;
      }
    }
    this.log.warn(`kill switch: removed ${removed} jobs for customer ${customerId}`);
    return removed;
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
