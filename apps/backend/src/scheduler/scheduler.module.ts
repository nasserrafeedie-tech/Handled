import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisProvider, REDIS_CONNECTION } from './redis.provider';
import { PublishQueueService } from './publish-queue.service';
import { PublishWorker } from './publish.worker';
import { CronService } from './cron.service';
import { DevCronController } from './dev-cron.controller';
import { ConciergeModule } from '../concierge/concierge.module';
import { PlaybookModule } from '../playbook/playbook.module';
import { ConnectModule } from '../connect/connect.module';

@Global()
@Module({
  // ConciergeModule for the weekly "your posts are ready" text. No cycle:
  // the Concierge never imports the scheduler.
  imports: [ScheduleModule.forRoot(), ConciergeModule, PlaybookModule, ConnectModule],
  controllers: [DevCronController],
  providers: [RedisProvider, PublishQueueService, PublishWorker, CronService],
  exports: [PublishQueueService, REDIS_CONNECTION],
})
export class SchedulerModule {}
