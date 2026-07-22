import { z } from "@hono/zod-openapi";

import { IsoDateTimeSchema } from "./common";

export const IntegrationStatusSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    configured: z.boolean(),
    healthy: z.boolean(),
    message: z.string().optional(),
    version: z.string().optional(),
  })
  .openapi("IntegrationStatus");

export const SystemStatusSchema = z
  .object({
    status: z.enum(["ready", "degraded", "unavailable"]),
    version: z.string(),
    environment: z.enum(["development", "test", "production"]),
    integrations: z.array(IntegrationStatusSchema),
    database: z.object({
      healthy: z.boolean(),
      migrationVersion: z.number().int().nonnegative(),
    }),
    setupComplete: z.boolean(),
    counts: z.object({
      libraryItems: z.number().int().nonnegative(),
      queuedJobs: z.number().int().nonnegative(),
      failedJobs: z.number().int().nonnegative(),
    }),
    now: IsoDateTimeSchema,
  })
  .openapi("SystemStatus");

export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
