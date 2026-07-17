import { Global, Module } from '@nestjs/common';
import { TaskBus } from './task-bus.service';

/**
 * Global so both the Concierge and cron can emit Tasks without re-importing.
 * The Operator registry is injected optionally (see TaskBus) and provided by
 * OperatorModule, keeping the spine decoupled from the executor.
 */
@Global()
@Module({
  providers: [TaskBus],
  exports: [TaskBus],
})
export class TasksModule {}
