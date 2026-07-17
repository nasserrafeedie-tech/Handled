import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TasksModule } from './tasks/tasks.module';
import { OperatorModule } from './operator/operator.module';
import { ConciergeModule } from './concierge/concierge.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TasksModule,
    OperatorModule,
    ConciergeModule,
    SchedulerModule,
  ],
})
export class AppModule {}
