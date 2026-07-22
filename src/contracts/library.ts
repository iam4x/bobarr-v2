import { z } from "@hono/zod-openapi";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./common";
import {
  AcquisitionStateSchema,
  MediaKindSchema,
  MonitorPolicySchema,
} from "./media";

/** @deprecated Prefer AcquisitionStateSchema. */
export const LibraryStatusSchema = AcquisitionStateSchema;

export const LibraryItemSchema = z
  .object({
    id: EntityIdSchema,
    kind: MediaKindSchema,
    tmdbId: z.number().int().positive().nullable(),
    parentId: EntityIdSchema.nullable(),
    seasonNumber: z.number().int().nonnegative().nullable(),
    episodeNumber: z.number().int().nonnegative().nullable(),
    title: z.string().min(1),
    year: z.number().int().min(1870).max(3000).nullable(),
    posterUrl: z.url().nullable(),
    status: LibraryStatusSchema,
    monitorPolicy: MonitorPolicySchema,
    acquisitionState: AcquisitionStateSchema,
    releaseDate: IsoDateTimeSchema.nullable(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .openapi("LibraryItem");

export const CreateLibraryItemRequestSchema = z
  .object({
    kind: MediaKindSchema,
    tmdbId: z.number().int().positive().nullable().default(null),
    parentId: EntityIdSchema.nullable().default(null),
    seasonNumber: z.number().int().nonnegative().nullable().default(null),
    episodeNumber: z.number().int().nonnegative().nullable().default(null),
    title: z.string().trim().min(1).max(500),
    year: z.number().int().min(1870).max(3000).nullable().default(null),
    posterUrl: z.url().nullable().default(null),
    status: LibraryStatusSchema.default("missing"),
    monitorPolicy: MonitorPolicySchema.default("all"),
    acquisitionState: AcquisitionStateSchema.optional(),
    releaseDate: IsoDateTimeSchema.nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.kind === "season" || value.kind === "episode") &&
      value.parentId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["parentId"],
        message: `${value.kind} records require a parentId`,
      });
    }
    if (value.kind === "episode" && value.episodeNumber === null) {
      context.addIssue({
        code: "custom",
        path: ["episodeNumber"],
        message: "Episode records require an episodeNumber",
      });
    }
  })
  .openapi("CreateLibraryItemRequest");

export const LibraryItemParamsSchema = z
  .object({
    id: EntityIdSchema,
  })
  .openapi("LibraryItemParams");

export const LibraryQuerySchema = PaginationQuerySchema.extend({
  status: LibraryStatusSchema.optional(),
  kind: MediaKindSchema.optional(),
  parentId: EntityIdSchema.optional(),
  monitorPolicy: MonitorPolicySchema.optional(),
}).openapi("LibraryQuery");

export const LibraryListResponseSchema = z
  .object({
    items: z.array(LibraryItemSchema),
    page: PageInfoSchema,
  })
  .openapi("LibraryListResponse");

export const DeleteLibraryItemResponseSchema = z
  .object({ deleted: z.boolean() })
  .openapi("DeleteLibraryItemResponse");

export type { AcquisitionState, MediaKind, MonitorPolicy } from "./media";
export type LibraryStatus = z.infer<typeof LibraryStatusSchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type CreateLibraryItemRequest = z.infer<
  typeof CreateLibraryItemRequestSchema
>;
export type LibraryQuery = z.infer<typeof LibraryQuerySchema>;
export {
  AcquisitionStateSchema,
  MediaKindSchema,
  MonitorPolicySchema,
} from "./media";
