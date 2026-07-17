import { Global, Module } from '@nestjs/common';
import { RedisProvider, REDIS_CONNECTION } from './redis.provider';
import { PublishQueueService } from './publish-queue.service';
import { PublishWorker } from './publish.worker';

@Global()
@Module({
  providers: [RedisProvider, PublishQueueService, PublishWorker],
  exports: [PublishQueueService, REDIS_CONNECTION],
})
export class SchedulerModule {}
