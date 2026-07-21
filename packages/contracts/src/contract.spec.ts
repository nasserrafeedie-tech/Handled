import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
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

test('parseLlmJson takes the model\'s final answer when it revises itself', () => {
  // Observed in a real generation: the model answered, caught itself breaking
  // a rule, and answered again. Taking the first object would ship the one it
  // explicitly retracted.
  const raw = [
    '```json',
    '{"subject": "An HVAC technician\'s van parked on a residential street"}',
    '```',
    '',
    'Wait, let me reconsider - that violates the "no specific business" rule.',
    '',
    '```json',
    '{"subject": "A diagnostic thermometer and wrench on a furnace control panel"}',
    '```',
  ].join('\n');
  const schema = z.object({ subject: z.string() });
  assert.equal(
    parseLlmJson(schema, raw).subject,
    'A diagnostic thermometer and wrench on a furnace control panel',
  );
});

test('parseLlmJson still handles a bare object and a single fenced one', () => {
  const schema = z.object({ a: z.number() });
  assert.equal(parseLlmJson(schema, '{"a":1}').a, 1);
  assert.equal(parseLlmJson(schema, '```json\n{"a":2}\n```').a, 2);
  assert.equal(parseLlmJson(schema, 'Sure! {"a":3}').a, 3);
});

test('parseLlmJson is not fooled by braces inside strings', () => {
  const schema = z.object({ note: z.string() });
  assert.equal(parseLlmJson(schema, '{"note":"a } inside"}').note, 'a } inside');
  assert.equal(parseLlmJson(schema, '{"note":"escaped \\" and } here"}').note, 'escaped " and } here');
});

test('parseLlmJson skips a truncated block and uses an earlier complete one', () => {
  // max_tokens can cut the final object mid-string.
  const schema = z.object({ subject: z.string() });
  const raw = '{"subject": "a complete answer"}\n\nActually, {"subject": "trunc';
  assert.equal(parseLlmJson(schema, raw).subject, 'a complete answer');
});

test('parseLlmJson still throws when there is no JSON at all', () => {
  const schema = z.object({ a: z.number() });
  assert.throws(() => parseLlmJson(schema, 'I cannot help with that.'), /not valid JSON/);
});
