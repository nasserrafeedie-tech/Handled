import { z } from 'zod';
import {
  PlanWeekPayload,
  DraftPostPayload,
  RegeneratePostPayload,
  SchedulePostPayload,
  CancelPostPayload,
  PublishDuePayload,
  FetchMetricsPayload,
  IngestMediaPayload,
  UpdateBrandProfilePayload,
  PauseCustomerPayload,
  MakeGraphicPayload,
  AssembleReelPayload,
  GenerateImagePayload,
  GenerateCarouselPayload,
} from './payloads';

/** Every Task type in the system (§4). */
export const TaskType = z.enum([
  'PLAN_WEEK',
  'DRAFT_POST',
  'REGENERATE_POST',
  'SCHEDULE_POST',
  'CANCEL_POST',
  'PUBLISH_DUE',
  'FETCH_METRICS',
  'INGEST_MEDIA',
  'UPDATE_BRAND_PROFILE',
  'PAUSE_CUSTOMER',
  'MAKE_GRAPHIC',
  'ASSEMBLE_REEL',
  'GENERATE_IMAGE',
  'GENERATE_CAROUSEL',
]);
export type TaskType = z.infer<typeof TaskType>;

/** Who emitted the Task (§4). The Concierge or a cron trigger — never a model freehand. */
export const TaskCreatedBy = z.enum(['concierge', 'cron']);
export type TaskCreatedBy = z.infer<typeof TaskCreatedBy>;

/**
 * Fields shared by the envelope of every Task. The `type` + `payload` pair is
 * validated as a discriminated union below so that each type is bound to its
 * own strict payload schema.
 */
const TaskEnvelope = {
  task_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  requires_approval: z.boolean(),
  created_by: TaskCreatedBy,
  created_at: z.string().datetime({ offset: true }),
};

/**
 * The Task, as a discriminated union on `type`. Each variant pins `payload` to
 * exactly the schema for that type — the compiler and the validator both enforce
 * the §4 rule "each Task type has its own strict payload schema".
 */
export const Task = z.discriminatedUnion('type', [
  z.object({ ...TaskEnvelope, type: z.literal('PLAN_WEEK'), payload: PlanWeekPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('DRAFT_POST'), payload: DraftPostPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('REGENERATE_POST'), payload: RegeneratePostPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('SCHEDULE_POST'), payload: SchedulePostPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('CANCEL_POST'), payload: CancelPostPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('PUBLISH_DUE'), payload: PublishDuePayload }),
  z.object({ ...TaskEnvelope, type: z.literal('FETCH_METRICS'), payload: FetchMetricsPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('INGEST_MEDIA'), payload: IngestMediaPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('UPDATE_BRAND_PROFILE'), payload: UpdateBrandProfilePayload }),
  z.object({ ...TaskEnvelope, type: z.literal('PAUSE_CUSTOMER'), payload: PauseCustomerPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('MAKE_GRAPHIC'), payload: MakeGraphicPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('GENERATE_IMAGE'), payload: GenerateImagePayload }),
  z.object({ ...TaskEnvelope, type: z.literal('GENERATE_CAROUSEL'), payload: GenerateCarouselPayload }),
  z.object({ ...TaskEnvelope, type: z.literal('ASSEMBLE_REEL'), payload: AssembleReelPayload }),
]);
export type Task = z.infer<typeof Task>;

/** Map from a Task type to the concrete payload TS type (handler signatures). */
export type PayloadFor<T extends TaskType> = Extract<Task, { type: T }>['payload'];
