import { Module } from '@nestjs/common';
import { PlaybookService } from './playbook.service';
import { ArchetypeClassifier } from './archetype-classifier.service';
import { ArchetypeResearchService } from './archetype-research.service';
import { ArchetypePerformanceService } from './archetype-performance.service';
import { LlmService } from '../operator/llm/llm.service';

/**
 * The Playbook Engine: the archetype store, the onboarding classifier, and
 * the research pass that grows the playbook when a novel business signs up.
 *
 * LlmService is stateless, so providing an instance here keeps the engine
 * independent of OperatorModule (§3 hard separation), the same way the
 * Concierge does.
 */
@Module({
  providers: [
    PlaybookService,
    ArchetypeClassifier,
    ArchetypeResearchService,
    ArchetypePerformanceService,
    LlmService,
  ],
  exports: [
    PlaybookService,
    ArchetypeClassifier,
    ArchetypeResearchService,
    ArchetypePerformanceService,
  ],
})
export class PlaybookModule {}
