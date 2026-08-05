import { Module } from '@nestjs/common';
import { PlaybookModule } from '../playbook/playbook.module';
import { ConciergeController } from './concierge.controller';
import { DevSmsController } from './dev-sms.controller';
import { SignupController } from './signup.controller';
import { EmailInboundController } from './email-inbound.controller';
import { ConciergeService } from './concierge.service';
import { RecapService } from './recap.service';
import { TwilioService } from './twilio.service';
import { EmailService } from './email.service';
import { OnboardingService } from './onboarding.service';
import { BusinessResearchService } from './business-research.service';
import { IntentService } from './intent.service';
import { LlmService } from '../operator/llm/llm.service';
import { StorageService } from '../common/storage.service';

@Module({
  imports: [PlaybookModule],
  controllers: [
    ConciergeController,
    DevSmsController,
    SignupController,
    EmailInboundController,
  ],
  // LlmService is stateless, so providing our own instance here keeps the
  // Concierge decoupled from OperatorModule (§3 hard separation).
  providers: [
    ConciergeService,
    RecapService,
    TwilioService,
    EmailService,
    OnboardingService,
    BusinessResearchService,
    IntentService,
    LlmService,
    StorageService,
  ],
  exports: [ConciergeService, TwilioService, EmailService, RecapService],
})
export class ConciergeModule {}
