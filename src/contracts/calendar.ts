import { z } from "@hono/zod-openapi";

import { EntityIdSchema, IsoDateTimeSchema } from "./common";

export const CalendarEventKindSchema = z
  .enum(["release", "download", "reminder"])
  .openapi("CalendarEventKind");
export const CalendarEventStatusSchema = z
  .enum(["scheduled", "completed", "cancelled"])
  .openapi("CalendarEventStatus");

export const CalendarEventSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1),
    kind: CalendarEventKindSchema,
    scheduledAt: IsoDateTimeSchema,
    libraryItemId: EntityIdSchema.nullable(),
    status: CalendarEventStatusSchema,
    metadata: z.record(z.string(), z.unknown()),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .openapi("CalendarEvent");

export const CreateCalendarEventRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    kind: CalendarEventKindSchema.default("reminder"),
    scheduledAt: IsoDateTimeSchema,
    libraryItemId: EntityIdSchema.nullable().default(null),
    status: CalendarEventStatusSchema.default("scheduled"),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .openapi("CreateCalendarEventRequest");

export const CalendarQuerySchema = z
  .object({
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
  })
  .refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
    path: ["to"],
    message: "to must not be before from",
  })
  .openapi("CalendarQuery");

export const CalendarListResponseSchema = z
  .object({ events: z.array(CalendarEventSchema) })
  .openapi("CalendarListResponse");

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CreateCalendarEventRequest = z.infer<
  typeof CreateCalendarEventRequestSchema
>;
