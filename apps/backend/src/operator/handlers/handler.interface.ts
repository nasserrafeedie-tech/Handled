import type { Task, TaskType, Result } from '@smm/contracts';

/** One deterministic handler per Task type (§7). */
export interface TaskHandler<T extends TaskType = TaskType> {
  readonly type: T;
  handle(task: Extract<Task, { type: T }>): Promise<Result>;
}

/** Helper for handlers to build a valid Result envelope. */
export function ok(
  taskId: string,
  summary: string,
  status: Result['status'] = 'done',
  data: unknown = null,
): Result {
  return { task_id: taskId, status, summary_for_owner: summary, data, error: null };
}

export function fail(
  taskId: string,
  summary: string,
  code: string,
  message: string,
  retryable = false,
): Result {
  return {
    task_id: taskId,
    status: 'failed',
    summary_for_owner: summary,
    data: null,
    error: { code, message, retryable },
  };
}
