import { Module } from '@nestjs/common';
import { ConciergeModule } from '../concierge/concierge.module';
import { UploadsController } from './uploads.controller';

/** Browser uploads for the clips/photos that don't fit over MMS. */
@Module({
  imports: [ConciergeModule],
  controllers: [UploadsController],
})
export class UploadsModule {}
