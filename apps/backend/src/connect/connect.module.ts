import { Module } from '@nestjs/common';
import { OperatorModule } from '../operator/operator.module';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';

/**
 * Connect flow. Depends on OperatorModule for the Post for Me client and the
 * token encryption service (both exported there).
 */
@Module({
  imports: [OperatorModule],
  controllers: [ConnectController],
  providers: [ConnectService],
})
export class ConnectModule {}
