import { z } from 'zod';
import { Task, TaskType } from './task';
import { Result } from './result';

export * from './enums';
export * from './payloads';
export * from './task';
export * from './result';
export * from './result-data';

/**
 * Validation helpers. §4 rule: "Validate on emit and on receive." Call these at
 * both ends of the Concierge↔Operator boundary so a bad envelope never reaches
 * a handler.
 */

export class ContractError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

/** Validate a Task on emit or receive. Throws ContractError on failure. */
export function parseTask(input: unknown): Task {
  const r = Task.safeParse(input);
  if (!r.success) {
    throw new ContractError('Invalid Task', r.error.issues);
  }
  return r.data;
}

/** Validate a Result. Throws ContractError on failure. */
export function parseResult(input: unknown): Result {
  const r = Result.safeParse(input);
  if (!r.success) {
    throw new ContractError('Invalid Result', r.error.issues);
  }
  return r.data;
}

export const isTaskType = (v: unknown): v is TaskType =>
  TaskType.safeParse(v).success;

/**
 * §4/§12: "All LLM steps return JSON only ... Parse defensively; retry once on
 * malformed output." This strips accidental markdown fences, parses, and
 * validates against the expected schema. Handlers wrap the LLM call in a
 * single retry on `LlmJsonError`.
 */
export class LlmJsonError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'LlmJsonError';
  }
}

// Input type is deliberately loose: schemas may transform (e.g. coerce an
// array into a string), so parse input and output need not match.
export function parseLlmJson<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: string): T {
  const cleaned = stripCodeFences(raw).trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new LlmJsonError('LLM output was not valid JSON', raw);
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    throw new LlmJsonError(
      `LLM JSON failed schema: ${r.error.issues.map((i) => i.message).join('; ')}`,
      raw,
    );
  }
  return r.data;
}

function stripCodeFences(s: string): string {
  const fence = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(s.trim());
  return fence ? fence[1] : s;
}
