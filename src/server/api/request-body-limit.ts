import type { ApiEnvironment } from "./app";
import type { MiddlewareHandler } from "hono";

import { AppError } from "../core";

export const DEFAULT_API_REQUEST_BODY_MAX_BYTES = 1024 * 1024;
export const MAX_TORRENT_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const MAX_TORRENT_REQUEST_BODY_BYTES =
  MAX_TORRENT_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

const RESTORE_PATH = "/api/v1/system/restore";
const DOWNLOADS_PATH = "/api/v1/downloads";

/**
 * Bound request bodies before JSON or multipart parsers can buffer them.
 * Restore is intentionally excluded because its route owns a larger streaming
 * cap and validates the staged SQLite image before publishing it.
 */
export function requestBodyLimitMiddleware(): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const request = context.req.raw;
    if (
      request.body === null ||
      request.method === "GET" ||
      request.method === "HEAD"
    ) {
      await next();
      return;
    }

    const limit = bodyLimitFor(request);
    if (limit === null) {
      await next();
      return;
    }

    const declaredLength = parseContentLength(
      request.headers.get("content-length"),
    );
    if (declaredLength !== null && declaredLength > limit) {
      await request.body
        .cancel("Request body exceeded its size limit")
        .catch(() => undefined);
      throw payloadTooLarge(limit);
    }

    const body = await readCappedBody(request, limit);
    context.req.raw = requestWithBody(request, body);
    await next();
  };
}

function bodyLimitFor(request: Request): number | null {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === RESTORE_PATH) return null;

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    request.method === "POST" &&
    path === DOWNLOADS_PATH &&
    contentType === "multipart/form-data"
  ) {
    return MAX_TORRENT_REQUEST_BODY_BYTES;
  }
  return DEFAULT_API_REQUEST_BODY_MAX_BYTES;
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes) {
        await reader
          .cancel("Request body exceeded its size limit")
          .catch(() => undefined);
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function requestWithBody(
  request: Request,
  body: Uint8Array<ArrayBuffer>,
): Request {
  return new Request(request.url, {
    body,
    headers: request.headers,
    method: request.method,
    signal: request.signal,
  });
}

function payloadTooLarge(maxBytes: number): AppError {
  return new AppError({
    code: "payload_too_large",
    message: `Request body exceeds the ${formatByteLimit(maxBytes)} limit`,
    status: 413,
  });
}

function formatByteLimit(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes)
    ? `${mebibytes} MiB`
    : `${bytes.toLocaleString("en-US")} bytes`;
}
