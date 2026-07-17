import { Module } from '@nestjs/common';
import { OPERATOR_REGISTRY } from '../tasks/operator-registry';
import { OperatorService } from './operator.service';
import { LlmService } from './llm/llm.service';
import { ModerationService } from './guardrails/moderation.service';
import { PublishGateService } from './guardrails/publish-gate.service';
import { TokenCryptoService } from './security/token-crypto.service';
import { PostForMeService } from './publishing/post-for-me.service';
import { PlanWeekHandler } from './handlers/plan-week.handler';
import { DraftPostHandler } from './handlers/draft-post.handler';
import { RegeneratePostHandler } from './handlers/regenerate-post.handler';
import { SchedulePostHandler } from './handlers/schedule-post.handler';
import { CancelPostHandler } from './handlers/cancel-post.handler';
import { PublishDueHandler } from './handlers/publish-due.handler';
import { FetchMetricsHandler } from './handlers/fetch-metrics.handler';
import { IngestMediaHandler } from './handlers/ingest-media.handler';
import { UpdateBrandProfileHandler } from './handlers/update-brand-profile.handler';
import { PauseCustomerHandler } from './handlers/pause-customer.handler';

@Module({
  providers: [
    // cross-cutting
    LlmService,
    ModerationService,
    PublishGateService,
    TokenCryptoService,
    PostForMeService,
    // handlers
    PlanWeekHandler,
    DraftPostHandler,
    RegeneratePostHandler,
    SchedulePostHandler,
    CancelPostHandler,
    PublishDueHandler,
    FetchMetricsHandler,
    IngestMediaHandler,
    UpdateBrandProfileHandler,
    PauseCustomerHandler,
    // registry, exposed to the TaskBus under the abstract token
    OperatorService,
    { provide: OPERATOR_REGISTRY, useExisting: OperatorService },
  ],
  exports: [OPERATOR_REGISTRY, TokenCryptoService],
})
export class OperatorModule {}
