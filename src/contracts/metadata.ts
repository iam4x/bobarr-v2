import { z } from "@hono/zod-openapi";

import { IsoDateTimeSchema } from "./common";
import { MediaKindSchema } from "./media";

export const MetadataCacheKeySchema = z
  .object({
    provider: z.string().min(1).max(100),
    kind: MediaKindSchema,
    externalId: z.string().min(1).max(200),
    locale: z.string().min(2).max(32).default("en-US"),
  })
  .strict()
  .openapi("MetadataCacheKey");

export const MetadataCacheEntrySchema = MetadataCacheKeySchema.extend({
  value: z.record(z.string(), z.unknown()),
  etag: z.string().nullable(),
  fetchedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
}).openapi("MetadataCacheEntry");

export type MetadataCacheKey = z.infer<typeof MetadataCacheKeySchema>;
export type MetadataCacheEntry = z.infer<typeof MetadataCacheEntrySchema>;
