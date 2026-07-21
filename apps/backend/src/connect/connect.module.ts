import { Module } from '@nestjs/common';
import { OperatorModule } from '../operator/operator.module';
import { ConciergeModule } from '../concierge/concierge.module';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';
import { ReauthService } from './reauth.service';

/**
 * Connect flow. Depends on OperatorModule for the Post for Me client and the
 * token encryption service (both exported there), and on ConciergeModule so
 * expiring connections can be raised in the owner's text thread.
 */
@Module({
  imports: [OperatorModule, ConciergeModule],
  controllers: [ConnectController],
  providers: [ConnectService, ReauthService],
  exports: [ReauthService],
})
export class ConnectModule {}
