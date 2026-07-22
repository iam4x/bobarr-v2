import { z } from "@hono/zod-openapi";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./common";

export const JobStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "cancelled"])
  .openapi("JobStatus");

export const JobSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.string().min(1),
    status: JobStatusSchema,
    progress: z.number().int().min(0).max(100),
    message: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()).nullable(),
    error: z.record(z.string(), z.unknown()).nullable(),
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    runAt: IsoDateTimeSchema,
    priority: z.number().int(),
    dedupeKey: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    finishedAt: IsoDateTimeSchema.nullable(),
  })
  .openapi("Job");

export const JobLogEntrySchema = z
  .object({
    timestamp: IsoDateTimeSchema,
    level: z.enum(["info", "warn", "error"]),
    event: z.string().min(1),
    message: z.string().nullable(),
  })
  .openapi("JobLogEntry");

export const JobDetailsSchema = JobSchema.extend({
  logs: z.array(JobLogEntrySchema),
}).openapi("JobDetails");

export const CreateJobRequestSchema = z
  .object({
    kind: z.string().trim().min(1).max(100),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .openapi("CreateJobRequest");

export const JobParamsSchema = z
  .object({ id: EntityIdSchema })
  .openapi("JobParams");

export const JobsQuerySchema = PaginationQuerySchema.extend({
  status: JobStatusSchema.optional(),
  kind: z.string().trim().min(1).max(100).optional(),
}).openapi("JobsQuery");

export const JobsListResponseSchema = z
  .object({
    jobs: z.array(JobSchema),
    page: PageInfoSchema,
  })
  .openapi("JobsListResponse");

export type Job = z.infer<typeof JobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobDetails = z.infer<typeof JobDetailsSchema>;
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;
