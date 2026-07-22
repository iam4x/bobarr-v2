import { z } from "@hono/zod-openapi";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./common";
import {
  DownloadStateSchema,
  MediaKindSchema,
  OrganizationStrategySchema,
} from "./media";

export const OpaqueReleaseIdSchema = z
  .string()
  .regex(/^rel_[A-Za-z0-9_-]{32,}$/, "Invalid release candidate identifier")
  .openapi("OpaqueReleaseId");

export const ReleaseCandidateSchema = z
  .object({
    id: OpaqueReleaseIdSchema,
    mediaId: EntityIdSchema.nullable(),
    tmdbId: z.number().int().positive().nullable(),
    mediaKind: MediaKindSchema,
    title: z.string().min(1),
    indexer: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    seeders: z.number().int().nonnegative(),
    leechers: z.number().int().nonnegative(),
    publishedAt: IsoDateTimeSchema.nullable(),
    quality: z.string().nullable(),
    score: z.number(),
    eligible: z.boolean(),
    reasons: z.array(z.string()),
    expiresAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
  })
  .openapi("ReleaseCandidate");

export const ReleaseCandidateInputSchema = ReleaseCandidateSchema.omit({
  id: true,
  expiresAt: true,
  createdAt: true,
}).openapi("ReleaseCandidateInput");

export const DownloadFileSchema = z
  .object({
    index: z.number().int().nonnegative(),
    name: z.string().min(1),
    length: z.number().int().nonnegative(),
    bytesCompleted: z.number().int().nonnegative(),
    wanted: z.boolean(),
    priority: z.enum(["low", "normal", "high"]),
  })
  .openapi("DownloadFile");

export const DownloadSchema = z
  .object({
    id: EntityIdSchema,
    mediaId: EntityIdSchema.nullable(),
    releaseCandidateId: OpaqueReleaseIdSchema.nullable(),
    client: z.string().min(1),
    externalId: z.string().min(1).nullable(),
    title: z.string().min(1),
    state: DownloadStateSchema,
    progress: z.number().min(0).max(100),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    downloadRate: z.number().int().nonnegative(),
    uploadRate: z.number().int().nonnegative(),
    etaSeconds: z.number().int().nonnegative().nullable(),
    downloadPath: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    files: z.array(DownloadFileSchema).optional(),
  })
  .openapi("Download");

export const CreateDownloadInputSchema = z
  .object({
    mediaId: EntityIdSchema.nullable().default(null),
    releaseCandidateId: OpaqueReleaseIdSchema.nullable().default(null),
    client: z.string().trim().min(1).max(100).default("transmission"),
    externalId: z.string().trim().min(1).max(500).nullable().default(null),
    title: z.string().trim().min(1).max(1000),
    state: DownloadStateSchema.default("queued"),
    totalBytes: z.number().int().nonnegative().default(0),
    downloadPath: z.string().max(4096).nullable().default(null),
  })
  .strict()
  .openapi("CreateDownloadInput");

export const DownloadPatchSchema = z
  .object({
    externalId: z.string().trim().min(1).max(500).nullable().optional(),
    state: DownloadStateSchema.optional(),
    progress: z.number().min(0).max(100).optional(),
    downloadedBytes: z.number().int().nonnegative().optional(),
    totalBytes: z.number().int().nonnegative().optional(),
    downloadRate: z.number().int().nonnegative().optional(),
    uploadRate: z.number().int().nonnegative().optional(),
    etaSeconds: z.number().int().nonnegative().nullable().optional(),
    downloadPath: z.string().max(4096).nullable().optional(),
    error: z.string().max(4000).nullable().optional(),
  })
  .strict()
  .openapi("DownloadPatch");

export const DownloadsQuerySchema = PaginationQuerySchema.extend({
  state: DownloadStateSchema.optional(),
  completion: z.enum(["active", "completed", "all"]).optional(),
  mediaId: EntityIdSchema.optional(),
}).openapi("DownloadsQuery");

export const DownloadsListSchema = z
  .object({ downloads: z.array(DownloadSchema), page: PageInfoSchema })
  .openapi("DownloadsList");

export const LibraryFileSchema = z
  .object({
    id: EntityIdSchema,
    mediaId: EntityIdSchema,
    downloadId: EntityIdSchema.nullable(),
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    quality: z.string().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    strategy: OrganizationStrategySchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .openapi("LibraryFile");

export const CreateLibraryFileInputSchema = LibraryFileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).openapi("CreateLibraryFileInput");

export type OpaqueReleaseId = z.infer<typeof OpaqueReleaseIdSchema>;
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>;
export type ReleaseCandidateInput = z.infer<typeof ReleaseCandidateInputSchema>;
export type Download = z.infer<typeof DownloadSchema>;
export type CreateDownloadInput = z.infer<typeof CreateDownloadInputSchema>;
export type DownloadPatch = z.infer<typeof DownloadPatchSchema>;
export type DownloadsQuery = z.infer<typeof DownloadsQuerySchema>;
export type LibraryFile = z.infer<typeof LibraryFileSchema>;
export type CreateLibraryFileInput = z.infer<
  typeof CreateLibraryFileInputSchema
>;
