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
import { ConciergeService } from '../concierge/concierge.service';
import { isWorkerRole } from '../common/service-role';

/** What PUBLISH_DUE hands back for the owner's thread. */
interface PublishNotices {
  notices?: { customer_id: string; message: string }[];
}

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
    private readonly concierge: ConciergeService,
  ) {}

  onModuleInit(): void {
    // Publishing stays on the web process; the dedicated worker only does
    // heavy video, so it shouldn't also consume the publish queue.
    if (isWorkerRole()) return;
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

        // The handler reports what the owner should hear but does not say it
        // — §3 keeps the Operator out of the text thread. Delivering it here
        // is what turns a failed publish from a silent non-event into
        // something the owner can act on.
        //
        // But only tell them ONCE. A retryable failure re-queues (attempts: 5),
        // and delivering on every attempt texts the same "couldn't publish" up
        // to five times over the backoff. So a retryable failure stays quiet
        // until the final attempt; a settled (non-retryable) failure or a
        // success notice is delivered immediately.
        const willRetry = result.status === 'failed' && Boolean(result.error?.retryable);
        const finalAttempt =
          (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);
        if (!willRetry || finalAttempt) {
          await this.deliverNotices(result);
        }

        if (willRetry) {
          throw new Error(result.error!.message); // let BullMQ retry
        }
      },
      {
        connection: this.connection,
        concurrency: 5,
        // Trim idle Redis chatter (Upstash bills per command) without hurting
        // publish timeliness: a due scheduled post wakes the worker via BullMQ's
        // delay marker regardless of drainDelay, so a 30s idle poll and a 2min
        // stalled sweep are plenty. More conservative than the reel worker
        // because publishing is the customer-facing, time-sensitive path.
        drainDelay: 30,
        stalledInterval: 120_000,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.log.warn(`publish job ${job?.id} failed: ${err.message}`),
    );
  }

  /** Text each owner whose post could not go out, and why. */
  private async deliverNotices(result: { data?: unknown }): Promise<void> {
    const notices = (result?.data as PublishNotices | undefined)?.notices ?? [];
    for (const n of notices) {
      await this.concierge
        .notify(n.customer_id, n.message)
        .catch((e) => this.log.warn(`notice to ${n.customer_id} failed: ${String(e)}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
