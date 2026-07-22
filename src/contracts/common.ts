import { z } from "@hono/zod-openapi";

export const EntityIdSchema = z.string().uuid().openapi("EntityId");

export const IsoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .openapi("IsoDateTime");

export const PaginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi("PaginationQuery");

export const PageInfoSchema = z
  .object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .openapi("PageInfo");

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
