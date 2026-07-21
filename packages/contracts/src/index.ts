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
  const candidates = jsonCandidates(raw);
  if (candidates.length === 0) {
    throw new LlmJsonError('LLM output was not valid JSON', raw);
  }

  // Last valid object wins. Models sometimes answer, reconsider in prose, and
  // answer again — an observed HVAC generation produced a subject, then wrote
  // "Wait, let me reconsider — that violates the no-specific-business rule",
  // then produced a compliant one. The first object is the retracted answer;
  // taking it would have shipped exactly the thing the model caught itself on.
  let lastIssue = '';
  for (let i = candidates.length - 1; i >= 0; i--) {
    const r = schema.safeParse(candidates[i]);
    if (r.success) return r.data;
    lastIssue = r.error.issues.map((issue) => issue.message).join('; ');
  }
  throw new LlmJsonError(`LLM JSON failed schema: ${lastIssue}`, raw);
}

/**
 * Every top-level JSON object in the text, in order, that parses on its own.
 *
 * Brace-matching rather than a regex because braces inside strings would
 * otherwise end an object early. Handles a bare object, a fenced one, several
 * fenced ones, and objects interleaved with the model's own commentary.
 */
function jsonCandidates(raw: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            out.push(JSON.parse(raw.slice(start, i + 1)));
          } catch {
            // Not valid on its own — a truncated or malformed block. Skip it
            // rather than failing the whole parse; a later one may be good.
          }
          start = -1;
        }
      }
    }
  }
  return out;
}
