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
import { REEL_QUEUE, type ReelJobData } from './queue.constants';
import { TaskBus } from '../tasks/task-bus.service';
import { ConciergeService } from '../concierge/concierge.service';
import { isWorkerRole } from '../common/service-role';

/**
 * Consumes the reel queue and does the heavy assembly — but ONLY on the worker
 * service (SERVICE_ROLE=worker). On the web process this is inert, so the ffmpeg
 * render never runs where customers are served. The job emits ASSEMBLE_REEL
 * through the TaskBus, which dispatches to the handler IN THIS process, then
 * texts the owner the result.
 *
 * concurrency: 1 — a 4K/HDR render is memory-heavy; processing one reel at a
 * time is the difference between a backed-up queue and an OOM.
 */
@Injectable()
export class ReelWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReelWorker.name);
  private worker?: Worker<ReelJobData>;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly bus: TaskBus,
    private readonly concierge: ConciergeService,
  ) {}

  onModuleInit(): void {
    if (!isWorkerRole()) {
      // Web process: reels are enqueued here, never rendered here.
      return;
    }
    this.log.log('reel worker starting (SERVICE_ROLE=worker)');
    this.worker = new Worker<ReelJobData>(
      REEL_QUEUE,
      async (job) => {
        const task: Task = {
          task_id: randomUUID(),
          customer_id: job.data.customerId,
          type: 'ASSEMBLE_REEL',
          payload: { platform: job.data.platform },
          requires_approval: false,
          created_by: 'concierge',
          created_at: new Date().toISOString(),
        } as Task;
        const result = await this.bus.emit(task);
        // Tell the owner how it went (§3: the Concierge owns the thread).
        await this.concierge
          .notify(job.data.customerId, result.summary_for_owner, {
            promptedByOwner: true,
          })
          .catch((e) => this.log.warn(`reel notice failed: ${String(e)}`));
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.log.error(`reel job ${job?.id} failed: ${err.message}`);
      // On the final attempt, tell the owner rather than leaving them waiting.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        void this.concierge
          .notify(
            job.data.customerId,
            "I hit a snag cutting your reel — I'll try again shortly.",
            { promptedByOwner: true },
          )
          .catch(() => undefined);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
