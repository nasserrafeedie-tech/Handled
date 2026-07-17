import { Module } from '@nestjs/common';
import { ConciergeController } from './concierge.controller';
import { ConciergeService } from './concierge.service';
import { TwilioService } from './twilio.service';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [ConciergeController],
  providers: [ConciergeService, TwilioService, OnboardingService],
  exports: [ConciergeService, TwilioService],
})
export class ConciergeModule {}
