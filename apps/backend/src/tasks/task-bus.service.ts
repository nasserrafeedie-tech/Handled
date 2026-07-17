import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  parseTask,
  parseResult,
  ContractError,
  type Task,
  type Result,
} from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { OPERATOR_REGISTRY, type OperatorRegistry } from './operator-registry';

/**
 * The spine (§4). Everything that wants work done goes through here.
 *
 *   emit(task) →  validate on emit  →  log Task
 *              →  dispatch to Operator
 *              →  validate on receive → log Result → return
 *
 * §4 rule: "Validate on emit and on receive" + "Log every Task and Result".
 * This is the single choke point that enforces both.
 */
@Injectable()
export class TaskBus {
  private readonly log = new Logger(TaskBus.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(OPERATOR_REGISTRY)
    private readonly operator?: OperatorRegistry,
  ) {}

  /**
   * Validate, persist, dispatch, and record the Result for one Task. Callers
   * (Concierge, cron) build a Task envelope and hand it here — they never touch
   * the Operator directly.
   */
  async emit(task: Task): Promise<Result> {
    // 1. Validate on emit — a malformed envelope never reaches a handler.
    const valid = parseTask(task);

    // 2. Log the Task (audit trail / debugger).
    await this.prisma.task.create({
      data: {
        id: valid.task_id,
        customerId: valid.customer_id,
        type: valid.type,
        payload: valid.payload as object,
        requiresApproval: valid.requires_approval,
        createdBy: valid.created_by,
        status: 'emitted',
      },
    });

    if (!this.operator) {
      // No executor wired (e.g. Concierge-only process). Leave the Task logged
      // for a worker to pick up; return a synthetic pending Result.
      const pending: Result = {
        task_id: valid.task_id,
        status: 'pending_approval',
        summary_for_owner: 'Queued.',
        data: null,
        error: null,
      };
      return pending;
    }

    await this.prisma.task.update({
      where: { id: valid.task_id },
      data: { status: 'running' },
    });

    // 3. Dispatch to the Operator.
    let result: Result;
    try {
      const raw = await this.operator.handle(valid);
      // 4. Validate on receive.
      result = parseResult(raw);
    } catch (err) {
      result = this.toFailedResult(valid, err);
    }

    // 5. Log the Result + reconcile Task status.
    await this.recordResult(valid.task_id, result);
    return result;
  }

  private async recordResult(taskId: string, result: Result): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.result.upsert({
        where: { taskId },
        create: {
          taskId,
          status: result.status,
          summaryForOwner: result.summary_for_owner,
          data: (result.data ?? undefined) as object | undefined,
          error: (result.error ?? undefined) as object | undefined,
        },
        update: {
          status: result.status,
          summaryForOwner: result.summary_for_owner,
          data: (result.data ?? undefined) as object | undefined,
          error: (result.error ?? undefined) as object | undefined,
        },
      }),
      this.prisma.task.update({
        where: { id: taskId },
        data: { status: result.status },
      }),
    ]);
  }

  private toFailedResult(task: Task, err: unknown): Result {
    if (err instanceof ContractError) {
      this.log.error(
        `Operator returned an invalid Result for ${task.type} (${task.task_id})`,
      );
    } else {
      this.log.error(
        `Operator threw handling ${task.type} (${task.task_id}): ${String(err)}`,
      );
    }
    return {
      task_id: task.task_id,
      status: 'failed',
      summary_for_owner:
        "Something went wrong on our end — I'm on it, nothing was posted.",
      data: null,
      error: {
        code: err instanceof ContractError ? 'invalid_result' : 'handler_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      },
    };
  }
}
