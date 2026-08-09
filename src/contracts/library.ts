import { z } from "@hono/zod-openapi";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./common";
import {
  AcquisitionStateSchema,
  DownloadStateSchema,
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

export const LibraryCardItemSchema = LibraryItemSchema.extend({
  rating: z
    .object({
      source: z.literal("tmdb"),
      value: z.number().min(0).max(10),
      votes: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  storage: z.object({
    libraryPath: z.string().min(1).nullable(),
    downloadPath: z.string().min(1).nullable(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    quality: z.string().min(1).nullable(),
  }),
  activeDownload: z
    .object({
      id: EntityIdSchema,
      state: DownloadStateSchema,
      progress: z.number().min(0).max(100),
      downloadedBytes: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative(),
      downloadRate: z.number().int().nonnegative(),
      etaSeconds: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  episodeProgress: z
    .object({
      available: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .nullable(),
  nextAirDate: IsoDateTimeSchema.nullable(),
}).openapi("LibraryCardItem");

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

export const LibraryAvailabilitySchema = z
  .enum(["available", "missing", "active", "failed"])
  .openapi("LibraryAvailability");

export const LibrarySortSchema = z
  .enum([
    "added_at.desc",
    "added_at.asc",
    "title.asc",
    "title.desc",
    "year.desc",
    "year.asc",
    "rating.desc",
    "rating.asc",
    "updated_at.desc",
  ])
  .openapi("LibrarySort");

export const LibraryQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: LibraryStatusSchema.optional(),
  /** UI availability buckets. Takes precedence over exact `status` when both are set. */
  availability: LibraryAvailabilitySchema.optional(),
  sort: LibrarySortSchema.optional(),
  genreId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(1870).max(3000).optional(),
  ratingMin: z.coerce.number().min(0).max(10).optional(),
  quality: z.string().trim().min(1).max(40).optional(),
  kind: MediaKindSchema.optional(),
  parentId: EntityIdSchema.optional(),
  monitorPolicy: MonitorPolicySchema.optional(),
}).openapi("LibraryQuery");

export const LibraryListResponseSchema = z
  .object({
    items: z.array(LibraryCardItemSchema),
    page: PageInfoSchema,
    summary: z.object({
      total: z.number().int().nonnegative(),
      downloaded: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
  })
  .openapi("LibraryListResponse");

export const DeleteLibraryItemResponseSchema = z
  .object({ deleted: z.boolean() })
  .openapi("DeleteLibraryItemResponse");

export type { AcquisitionState, MediaKind, MonitorPolicy } from "./media";
export type LibraryStatus = z.infer<typeof LibraryStatusSchema>;
export type LibraryAvailability = z.infer<typeof LibraryAvailabilitySchema>;
export type LibrarySort = z.infer<typeof LibrarySortSchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type LibraryCardItem = z.infer<typeof LibraryCardItemSchema>;
export type CreateLibraryItemRequest = z.infer<
  typeof CreateLibraryItemRequestSchema
>;
export type LibraryQuery = z.infer<typeof LibraryQuerySchema>;
export {
  AcquisitionStateSchema,
  MediaKindSchema,
  MonitorPolicySchema,
} from "./media";
