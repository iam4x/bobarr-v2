import type { ApiDependencies, ApiEnvironment } from "./app";

import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";

import {
  ApiErrorEnvelopeSchema,
  DismissScanReviewResponseSchema,
  ResolveScanReviewRequestSchema,
  ScanReviewListQuerySchema,
  ScanReviewListResponseSchema,
  ScanReviewParamsSchema,
  ScanReviewSchema,
} from "../../contracts";
import { AppError } from "../core";
import { createScanReviewService } from "../library";

const errorResponse = {
  content: { "application/json": { schema: ApiErrorEnvelopeSchema } },
  description: "Standard API error",
} as const;

const listRoute = createRoute({
  method: "get",
  path: "/api/v1/library/scan-reviews",
  tags: ["library"],
  security: [{ sessionCookie: [] }],
  request: { query: ScanReviewListQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: ScanReviewListResponseSchema } },
      description: "Library scan reviews",
    },
    default: errorResponse,
  },
});

const resolveRoute = createRoute({
  method: "post",
  path: "/api/v1/library/scan-reviews/{id}/resolve",
  tags: ["library"],
  security: [{ sessionCookie: [] }],
  request: {
    params: ScanReviewParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: ResolveScanReviewRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ScanReviewSchema } },
      description: "Resolved scan review",
    },
    default: errorResponse,
  },
});

const dismissRoute = createRoute({
  method: "post",
  path: "/api/v1/library/scan-reviews/{id}/dismiss",
  tags: ["library"],
  security: [{ sessionCookie: [] }],
  request: { params: ScanReviewParamsSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: DismissScanReviewResponseSchema },
      },
      description: "Dismissed scan review",
    },
    default: errorResponse,
  },
});

export function registerScanReviewRoutes(
  app: OpenAPIHono<ApiEnvironment>,
  dependencies: ApiDependencies,
): void {
  const reviews = createScanReviewService({
    repositories: dependencies.repositories,
    events: dependencies.events,
    tmdb: async () => {
      if (dependencies.integrations === undefined) {
        throw new AppError({
          code: "service_unavailable",
          message: "TMDB integration is unavailable",
          status: 503,
        });
      }
      return dependencies.integrations.tmdb();
    },
  });

  app.openapi(listRoute, (context) => {
    const query = context.req.valid("query");
    const result = dependencies.repositories.scanReviews.list(query);
    return context.json(
      {
        reviews: result.reviews,
        page: { limit: query.limit, offset: query.offset, total: result.total },
      },
      200,
    );
  });
  app.openapi(resolveRoute, async (context) => {
    const { id } = context.req.valid("param");
    const { tmdbId } = context.req.valid("json");
    return context.json(
      await reviews.resolve(id, tmdbId, context.req.raw.signal),
      200,
    );
  });
  app.openapi(dismissRoute, (context) => {
    const review = reviews.dismiss(context.req.valid("param").id);
    return context.json({ dismissed: true as const, review }, 200);
  });
}
