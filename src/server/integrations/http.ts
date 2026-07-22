export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class IntegrationError extends Error {
  readonly integration: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    integration: string,
    message: string,
    options: {
      cause?: unknown;
      status?: number;
      retryable?: boolean;
      details?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "IntegrationError";
    this.integration = integration;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function requestSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

export async function parseJsonResponse(
  integration: string,
  response: Response,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new IntegrationError(integration, "Upstream returned invalid JSON", {
      cause: error,
      status: response.status,
      retryable: response.status >= 500,
    });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
