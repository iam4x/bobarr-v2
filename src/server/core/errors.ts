import type { ApiErrorCode, ApiErrorIssue } from "../../contracts";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status:
    | 400
    | 401
    | 403
    | 404
    | 409
    | 413
    | 422
    | 423
    | 429
    | 500
    | 503;
  readonly issues?: ApiErrorIssue[];

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    status: AppError["status"];
    issues?: ApiErrorIssue[];
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.issues = options.issues;
  }
}

export function notFound(message: string): AppError {
  return new AppError({ code: "not_found", message, status: 404 });
}

export function conflict(message: string): AppError {
  return new AppError({ code: "conflict", message, status: 409 });
}
