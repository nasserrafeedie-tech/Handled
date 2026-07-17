import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTask,
  parseResult,
  parseLlmJson,
  ContractError,
  LlmJsonError,
  PlanWeekLlmOutput,
} from './index';

const base = {
  task_id: '11111111-1111-1111-1111-111111111111',
  customer_id: '22222222-2222-2222-2222-222222222222',
  requires_approval: false,
  created_by: 'cron' as const,
  created_at: '2026-07-17T12:00:00Z',
};

test('parseTask accepts a well-formed PLAN_WEEK task', () => {
  const t = parseTask({
    ...base,
    type: 'PLAN_WEEK',
    payload: { week_start: '2026-07-20T00:00:00Z' },
  });
  assert.equal(t.type, 'PLAN_WEEK');
});

test('parseTask rejects a payload from the wrong type', () => {
  assert.throws(
    () =>
      parseTask({
        ...base,
        type: 'SCHEDULE_POST',
        payload: { week_start: '2026-07-20T00:00:00Z' }, // PLAN_WEEK payload
      }),
    ContractError,
  );
});

test('parseTask rejects unknown payload keys (strict)', () => {
  assert.throws(
    () =>
      parseTask({
        ...base,
        type: 'PAUSE_CUSTOMER',
        payload: { reason: 'owner_stop', sneaky: true },
      }),
    ContractError,
  );
});

test('parseResult requires an error object when failed', () => {
  assert.throws(
    () =>
      parseResult({
        task_id: base.task_id,
        status: 'failed',
        summary_for_owner: 'it broke',
        data: null,
        error: null,
      }),
    ContractError,
  );
});

test('parseLlmJson strips code fences and validates', () => {
  const raw = '```json\n{"slots":[]}\n```';
  const out = parseLlmJson(PlanWeekLlmOutput, raw);
  assert.deepEqual(out.slots, []);
});

test('parseLlmJson throws LlmJsonError on non-JSON', () => {
  assert.throws(() => parseLlmJson(PlanWeekLlmOutput, 'sorry, here you go!'), LlmJsonError);
});
