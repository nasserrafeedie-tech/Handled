import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ReelLabController } from './reel-lab.controller';
import { BusinessMetricsService } from './business-metrics.service';
import { TasksModule } from '../tasks/tasks.module';
import { OperatorModule } from '../operator/operator.module';
import { BillingModule } from '../billing/billing.module';
import { ConciergeModule } from '../concierge/concierge.module';

@Module({
  imports: [TasksModule, OperatorModule, BillingModule, ConciergeModule],
  controllers: [AdminController, ReelLabController],
  providers: [BusinessMetricsService],
})
export class AdminModule {}
