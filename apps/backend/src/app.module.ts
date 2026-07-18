import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { PrismaModule } from './prisma/prisma.module';
import { TasksModule } from './tasks/tasks.module';
import { OperatorModule } from './operator/operator.module';
import { ConciergeModule } from './concierge/concierge.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load the repo-root .env whether started from the root or from
      // apps/backend (npm workspaces run scripts with cwd = the package dir).
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), '../../.env'),
      ],
    }),
    PrismaModule,
    TasksModule,
    OperatorModule,
    ConciergeModule,
    SchedulerModule,
  ],
})
export class AppModule {}
