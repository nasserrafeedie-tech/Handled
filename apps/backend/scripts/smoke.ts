/**
 * Infra-free smoke test: exercises the real §4 contract + §8 guardrail logic
 * (no DB/Redis needed) to prove the core decision path runs.
 *   npx tsx scripts/smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { parseTask, parseResult, type Task } from '@smm/contracts';
import { PublishGateService } from '../src/operator/guardrails/publish-gate.service';
import { ModerationService } from '../src/operator/guardrails/moderation.service';

const line = (s: string) => console.log(s);

async function main() {
  const gate = new PublishGateService();
  const mod = new ModerationService();

  line('── §4 contract ─────────────────────────────');
  const task: Task = parseTask({
    task_id: randomUUID(),
    customer_id: randomUUID(),
    type: 'PLAN_WEEK',
    payload: { week_start: '2026-07-20T00:00:00Z' },
    requires_approval: false,
    created_by: 'cron',
    created_at: new Date().toISOString(),
  });
  line(`  valid Task accepted: ${task.type}`);

  try {
    parseTask({ ...task, type: 'SCHEDULE_POST' }); // payload no longer matches
    line('  ERROR: mismatched payload was wrongly accepted');
  } catch {
    line('  mismatched payload rejected ✓');
  }

  line('\n── §8 risk classification ──────────────────');
  const promo = 'Flash SALE this weekend — 50% off, today only!';
  const evergreen = 'A little behind-the-scenes from the team this morning.';
  line(`  promo    -> ${gate.classifyRisk(promo)} (expect high)`);
  line(`  evergreen-> ${gate.classifyRisk(evergreen)} (expect low)`);

  line('\n── §8 trust-ramp gate ──────────────────────');
  line(`  approve_all + low  -> auto=${gate.decide('approve_all', 'low').autoPublishAllowed} (expect false)`);
  line(`  auto_low_risk+ low -> auto=${gate.decide('auto_low_risk', 'low').autoPublishAllowed} (expect true)`);
  line(`  full_auto    + high-> auto=${gate.decide('full_auto', 'high').autoPublishAllowed} (expect false: high always confirmed)`);

  line('\n── §8 moderation ───────────────────────────');
  const clean = await mod.screen({ caption: evergreen, hashtags: ['team'], blackoutTopics: [] });
  const blocked = await mod.screen({ caption: 'we never discuss politics here', hashtags: [], blackoutTopics: ['politics'] });
  line(`  clean caption passed:   ${clean.passed} (expect true)`);
  line(`  blackout topic blocked: ${!blocked.passed} (expect true) reasons=${blocked.reasons.join(',')}`);

  line('\n── §4 Result envelope ──────────────────────');
  const result = parseResult({
    task_id: task.task_id,
    status: 'done',
    summary_for_owner: 'Your week is planned — 4 posts lined up.',
    data: null,
    error: null,
  });
  line(`  valid Result accepted: "${result.summary_for_owner}"`);

  line('\nALL SMOKE CHECKS RAN ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
