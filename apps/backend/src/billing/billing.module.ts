import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { BillingService } from './billing.service';
import { ReferralCreditService } from './referral-credit.service';
import { ConciergeModule } from '../concierge/concierge.module';

@Module({
  imports: [ConciergeModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, ReferralCreditService],
  exports: [BillingService, ReferralCreditService],
})
export class BillingModule {}
