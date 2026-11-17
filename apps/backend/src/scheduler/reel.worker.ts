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
import { reelNotice } from './weekly-animated';

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
        const task: Task = buildReelTask(job.data);
        const result = await this.bus.emit(task);
        // Tell the owner how it went (§3: the Concierge owns the thread).
        const notice = reelNotice(job.data, result);
        if (!notice) {
          this.log.log(`weekly reel for ${job.data.customerId}: ${result.status}, no text`);
          return;
        }
        await this.concierge
          .notify(job.data.customerId, notice.text, { promptedByOwner: notice.promptedByOwner })
          .catch((e) => this.log.warn(`reel notice failed: ${String(e)}`));
      },
      {
        connection: this.connection,
        concurrency: 1,
        // Upstash bills per Redis command, and BullMQ's default idle behaviour
        // is chatty: a blocking poll every 5s plus a stalled-job sweep every
        // 30s runs 24/7 whether or not a reel is ever cut. That baseline is
        // what exhausted the request quota. A newly-added job still wakes the
        // blocking poll instantly (it's pushed onto the list the worker is
        // blocked on), so a long drainDelay costs no pickup latency — it just
        // stops the idle worker from re-issuing the poll every few seconds.
        // Reels are rare and never latency-critical, so poll lazily.
        drainDelay: 60,
        stalledInterval: 300_000,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.log.error(`reel job ${job?.id} failed: ${err.message}`);
      // On the final attempt, tell the owner rather than leaving them waiting.
      if (job && !job.data.weekly && job.attemptsMade >= (job.opts.attempts ?? 1)) {
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

/** The task a reel job stands for: a cut of footage, or an animated reel. */
export function buildReelTask(data: ReelJobData): Task {
  const envelope = {
    task_id: randomUUID(),
    customer_id: data.customerId,
    requires_approval: false,
    created_by: 'concierge' as const,
    created_at: new Date().toISOString(),
  };
  if (data.animated) {
    return {
      ...envelope,
      type: 'ANIMATED_REEL',
      payload: {
        kind: data.animated.kind,
        platform: data.platform,
        ...(data.animated.offerText ? { offer_text: data.animated.offerText } : {}),
        ...(data.animated.mediaAssetIds?.length === 2 ? { media_asset_ids: data.animated.mediaAssetIds } : {}),
      },
    } as Task;
  }
  return {
    ...envelope,
    type: 'ASSEMBLE_REEL',
    payload: {
      platform: data.platform,
      ...(data.mediaAssetIds?.length ? { media_asset_ids: data.mediaAssetIds } : {}),
    },
  } as Task;
}
