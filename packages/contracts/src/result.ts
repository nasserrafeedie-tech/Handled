import { z } from 'zod';

/** §4 Result status. `needs_owner_input` and `pending_approval` drive the Concierge. */
export const ResultStatus = z.enum([
  'done',
  'needs_owner_input',
  'pending_approval',
  'failed',
]);
export type ResultStatus = z.infer<typeof ResultStatus>;

/**
 * The Result (§4). The Operator returns this; the Concierge translates
 * `summary_for_owner` into (or sends verbatim as) a human SMS.
 *
 * `data` stays loose here (`z.unknown()`) at the envelope level because it is
 * structured per Task type — the per-type result-data schemas live in
 * `result-data.ts` and are validated by the specific handler that produced them.
 */
export const Result = z
  .object({
    task_id: z.string().uuid(),
    status: ResultStatus,
    summary_for_owner: z
      .string()
      .min(1)
      .max(480)
      .describe('one human line the Concierge can send or rephrase'),
    data: z.unknown().nullable().default(null),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean().default(false),
      })
      .nullable()
      .default(null),
  })
  .strict()
  .refine((r) => (r.status === 'failed' ? r.error !== null : true), {
    message: 'a failed Result must include an error object',
    path: ['error'],
  });
export type Result = z.infer<typeof Result>;
