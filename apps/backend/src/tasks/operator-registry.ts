import type { Task, Result } from '@smm/contracts';

/**
 * DI token + interface for the Operator's handler registry. The TasksModule
 * depends on this abstraction, not on the OperatorModule directly — that keeps
 * the audit spine (TaskBus) decoupled from the executor and avoids a circular
 * import. OperatorModule provides the concrete implementation.
 */
export const OPERATOR_REGISTRY = Symbol('OPERATOR_REGISTRY');

export interface OperatorRegistry {
  /** Execute a validated Task and return a Result. Must not throw for expected
   *  failures — return a `failed` Result with an error instead. */
  handle(task: Task): Promise<Result>;
}
