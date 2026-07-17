import { Injectable, Logger } from '@nestjs/common';
import type { Task, Result, TaskType } from '@smm/contracts';
import type { OperatorRegistry } from '../tasks/operator-registry';
import type { TaskHandler } from './handlers/handler.interface';
import { PlanWeekHandler } from './handlers/plan-week.handler';
import { DraftPostHandler } from './handlers/draft-post.handler';
import { RegeneratePostHandler } from './handlers/regenerate-post.handler';
import { SchedulePostHandler } from './handlers/schedule-post.handler';
import { CancelPostHandler } from './handlers/cancel-post.handler';
import { PublishDueHandler } from './handlers/publish-due.handler';
import { FetchMetricsHandler } from './handlers/fetch-metrics.handler';
import { IngestMediaHandler } from './handlers/ingest-media.handler';
import { UpdateBrandProfileHandler } from './handlers/update-brand-profile.handler';
import { PauseCustomerHandler } from './handlers/pause-customer.handler';

/**
 * Agent B entry point (§3). Implements the OperatorRegistry the TaskBus calls.
 * Pure dispatch: look up the handler for the Task type and run it. All
 * intelligence lives in the individual handlers (§7).
 */
@Injectable()
export class OperatorService implements OperatorRegistry {
  private readonly log = new Logger(OperatorService.name);
  private readonly handlers = new Map<TaskType, TaskHandler>();

  constructor(
    planWeek: PlanWeekHandler,
    draftPost: DraftPostHandler,
    regenerate: RegeneratePostHandler,
    schedule: SchedulePostHandler,
    cancel: CancelPostHandler,
    publishDue: PublishDueHandler,
    fetchMetrics: FetchMetricsHandler,
    ingestMedia: IngestMediaHandler,
    updateProfile: UpdateBrandProfileHandler,
    pause: PauseCustomerHandler,
  ) {
    for (const h of [
      planWeek,
      draftPost,
      regenerate,
      schedule,
      cancel,
      publishDue,
      fetchMetrics,
      ingestMedia,
      updateProfile,
      pause,
    ] as TaskHandler[]) {
      this.handlers.set(h.type, h);
    }
  }

  async handle(task: Task): Promise<Result> {
    const handler = this.handlers.get(task.type);
    if (!handler) {
      // Should be unreachable — the contract enumerates every type — but fail
      // loud rather than silently drop.
      return {
        task_id: task.task_id,
        status: 'failed',
        summary_for_owner: 'That request type isn\'t supported yet.',
        data: null,
        error: { code: 'no_handler', message: `no handler for ${task.type}`, retryable: false },
      };
    }
    this.log.log(`handling ${task.type} (${task.task_id})`);
    return handler.handle(task as never);
  }
}
