import { z } from "@hono/zod-openapi";

export const ApiErrorCodeSchema = z
  .enum([
    "bad_request",
    "validation_failed",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "setup_required",
    "already_configured",
    "account_locked",
    "rate_limited",
    "payload_too_large",
    "service_unavailable",
    "integration_error",
    "candidate_expired",
    "invalid_magnet",
    "internal_error",
  ])
  .openapi("ApiErrorCode");

export const ApiErrorIssueSchema = z
  .object({
    path: z.string(),
    message: z.string(),
  })
  .openapi("ApiErrorIssue");

export const ApiErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: ApiErrorCodeSchema,
      message: z.string(),
      fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
      requestId: z.string().min(1),
    }),
  })
  .openapi("ApiErrorEnvelope");

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
export type ApiErrorIssue = z.infer<typeof ApiErrorIssueSchema>;
