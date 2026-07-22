import { z } from "@hono/zod-openapi";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./common";

export const ScanReviewStatusSchema = z
  .enum(["pending", "resolved", "dismissed"])
  .openapi("ScanReviewStatus");

export const ScanReviewKindSchema = z
  .enum(["movie", "series"])
  .openapi("ScanReviewKind");

export const ScanReviewFileSchema = z
  .object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .openapi("ScanReviewFile");

export const ScanReviewCandidateSchema = z
  .object({
    tmdbId: z.number().int().positive(),
    kind: ScanReviewKindSchema,
    title: z.string().min(1).max(500),
    year: z.number().int().min(1870).max(3000).nullable(),
    posterPath: z.string().nullable(),
    overview: z.string(),
  })
  .strict()
  .openapi("ScanReviewCandidate");

export const ScanReviewSchema = z
  .object({
    id: EntityIdSchema,
    kind: ScanReviewKindSchema,
    title: z.string().min(1).max(500),
    year: z.number().int().min(1870).max(3000).nullable(),
    rootPath: z.string().min(1),
    files: z.array(ScanReviewFileSchema).min(1),
    candidates: z.array(ScanReviewCandidateSchema),
    status: ScanReviewStatusSchema,
    resolvedTmdbId: z.number().int().positive().nullable(),
    mediaItemId: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    resolvedAt: IsoDateTimeSchema.nullable(),
  })
  .openapi("ScanReview");

export const ScanReviewListQuerySchema = PaginationQuerySchema.extend({
  status: ScanReviewStatusSchema.optional().default("pending"),
  kind: ScanReviewKindSchema.optional(),
}).openapi("ScanReviewListQuery");

export const ScanReviewListResponseSchema = z
  .object({
    reviews: z.array(ScanReviewSchema),
    page: PageInfoSchema,
  })
  .openapi("ScanReviewListResponse");

export const ScanReviewParamsSchema = z
  .object({ id: EntityIdSchema })
  .openapi("ScanReviewParams");

export const ResolveScanReviewRequestSchema = z
  .object({ tmdbId: z.number().int().positive() })
  .strict()
  .openapi("ResolveScanReviewRequest");

export const DismissScanReviewResponseSchema = z
  .object({ dismissed: z.literal(true), review: ScanReviewSchema })
  .openapi("DismissScanReviewResponse");

export type ScanReviewStatus = z.infer<typeof ScanReviewStatusSchema>;
export type ScanReviewKind = z.infer<typeof ScanReviewKindSchema>;
export type ScanReviewFile = z.infer<typeof ScanReviewFileSchema>;
export type ScanReviewCandidate = z.infer<typeof ScanReviewCandidateSchema>;
export type ScanReview = z.infer<typeof ScanReviewSchema>;
export type ScanReviewListQuery = z.infer<typeof ScanReviewListQuerySchema>;
export type ResolveScanReviewRequest = z.infer<
  typeof ResolveScanReviewRequestSchema
>;
