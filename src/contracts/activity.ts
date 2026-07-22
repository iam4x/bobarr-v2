import { z } from "@hono/zod-openapi";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./common";

export const ActivityLevelSchema = z
  .enum(["info", "success", "warning", "error"])
  .openapi("ActivityLevel");

export const ActivityEventSchema = z
  .object({
    id: EntityIdSchema,
    type: z.string().min(1),
    level: ActivityLevelSchema,
    message: z.string().min(1),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
    createdAt: IsoDateTimeSchema,
  })
  .openapi("ActivityEvent");

export const CreateActivityEventInputSchema = ActivityEventSchema.omit({
  id: true,
  createdAt: true,
}).openapi("CreateActivityEventInput");

export const ActivityQuerySchema = PaginationQuerySchema.extend({
  level: ActivityLevelSchema.optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
}).openapi("ActivityQuery");

export const ActivityListSchema = z
  .object({ events: z.array(ActivityEventSchema), page: PageInfoSchema })
  .openapi("ActivityList");

export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type CreateActivityEventInput = z.infer<
  typeof CreateActivityEventInputSchema
>;
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
