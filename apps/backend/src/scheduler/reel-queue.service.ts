import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from './redis.provider';
import { REEL_QUEUE, reelJobId, type ReelJobData } from './queue.constants';

/**
 * Enqueue reel assembly onto the heavy-video queue. Callers (the upload path)
 * add a job and return immediately; the dedicated worker service does the
 * actual ffmpeg render, off the web instance.
 */
@Injectable()
export class ReelQueueService implements OnModuleDestroy {
  private readonly log = new Logger(ReelQueueService.name);
  private readonly queue: Queue<ReelJobData>;

  constructor(@Inject(REDIS_CONNECTION) connection: Redis) {
    this.queue = new Queue<ReelJobData>(REEL_QUEUE, {
      connection,
      defaultJobOptions: {
        // A reel render is expensive; one retry covers a transient blip without
        // burning the box on a clip that will never encode.
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: 200,
        removeOnFail: false,
      },
    });
  }

  /** Idempotent per customer: a new upload replaces any pending reel job. */
  async enqueue(data: ReelJobData): Promise<void> {
    // An animated reel has its own slot, so asking for one never cancels a
    // pending cut of the owner's footage (or the other way round).
    const jobId = reelJobId(data.customerId, !!data.animated, !!data.weekly);
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(data.animated ? 'animated' : 'assemble', data, { jobId });
    this.log.log(`queued ${data.weekly ? 'weekly ' : ''}${data.animated ? 'animated ' : ''}reel for ${data.customerId}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
