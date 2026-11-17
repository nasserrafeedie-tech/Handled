import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ReelLabController } from './reel-lab.controller';
import { BusinessMetricsService } from './business-metrics.service';
import { TasksModule } from '../tasks/tasks.module';
import { OperatorModule } from '../operator/operator.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TasksModule, OperatorModule, BillingModule],
  controllers: [AdminController, ReelLabController],
  providers: [BusinessMetricsService],
})
export class AdminModule {}
