import type { ApiDependencies, ApiEnvironment } from "./app";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { z } from "@hono/zod-openapi";

import {
  ApiErrorEnvelopeSchema,
  BackupRestoreStatusSchema,
  CancelStagedRestoreSchema,
  StagedRestoreSchema,
} from "../../contracts";
import { AppError } from "../core";

const STAGE_CONFIRMATION = "stage-restore";
const CANCEL_CONFIRMATION = "cancel-staged-restore";

export function registerBackupRestoreRoutes(
  app: OpenAPIHono<ApiEnvironment>,
  dependencies: ApiDependencies,
): void {
  app.get("/api/v1/system/backups", async (context) => {
    const restore = requireRestore(dependencies);
    const [backups, stagedRestore] = await Promise.all([
      restore.listVerifiedBackups(),
      restore.getStagedRestore(),
    ]);
    return context.json({
      backups,
      stagedRestore,
      maxUploadBytes: restore.maxUploadBytes,
    });
  });

  app.post("/api/v1/system/restore", async (context) => {
    const restore = requireRestore(dependencies);
    if (
      context.req.header("x-bobarr-restore-confirmation") !== STAGE_CONFIRMATION
    ) {
      throw new AppError({
        code: "validation_failed",
        message: "Explicit restore confirmation is required",
        status: 422,
        issues: [
          {
            path: "x-bobarr-restore-confirmation",
            message: `Use the exact value ${STAGE_CONFIRMATION}`,
          },
        ],
      });
    }
    const contentType = context.req.header("content-type")?.split(";", 1)[0];
    if (
      contentType !== "application/octet-stream" &&
      contentType !== "application/vnd.sqlite3"
    ) {
      throw badRestore("Upload a raw SQLite file as application/octet-stream");
    }
    const contentLength = Number(context.req.header("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > restore.maxUploadBytes
    ) {
      throw badRestore("Restore upload exceeds the configured size limit");
    }

    let staged;
    try {
      staged = await restore.stageRestore(
        await readCappedBody(context.req.raw, restore.maxUploadBytes),
      );
    } catch (error) {
      throw badRestore(
        error instanceof Error
          ? error.message
          : "The uploaded backup could not be verified",
      );
    }
    const activity = dependencies.repositories.activity.append({
      type: "restore.staged",
      level: "warning",
      message: "A verified database restore was staged for the next restart",
      entityType: null,
      entityId: null,
      data: {
        migrationVersion: staged.migrationVersion,
        sha256: staged.sha256,
      },
    });
    dependencies.events?.publish("activity.created", { id: activity.id });
    return context.json(staged, 202);
  });

  app.delete("/api/v1/system/restore", async (context) => {
    if (
      context.req.header("x-bobarr-restore-confirmation") !==
      CANCEL_CONFIRMATION
    ) {
      throw badRestore("Explicit staged-restore cancellation is required");
    }
    return context.json(
      { cancelled: await requireRestore(dependencies).cancelStagedRestore() },
      200,
    );
  });

  registerDocumentation(app);
}

async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
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
        await reader.cancel("Restore upload exceeded its size limit");
        throw new RangeError(
          "Restore upload exceeds the configured size limit",
        );
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

function registerDocumentation(app: OpenAPIHono<ApiEnvironment>): void {
  const errors = {
    default: {
      content: { "application/json": { schema: ApiErrorEnvelopeSchema } },
      description: "Standard API error",
    },
  } as const;
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/v1/system/backups",
    tags: ["system"],
    security: [{ sessionCookie: [] }],
    responses: {
      200: json(
        BackupRestoreStatusSchema,
        "Verified backup and restore status",
      ),
      ...errors,
    },
  });
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/v1/system/restore",
    tags: ["system"],
    security: [{ sessionCookie: [] }],
    request: {
      headers: z.object({
        "x-bobarr-restore-confirmation": z.literal(STAGE_CONFIRMATION),
      }),
      body: {
        required: true,
        content: {
          "application/octet-stream": {
            schema: z.string().openapi({ format: "binary" }),
          },
        },
      },
    },
    responses: {
      202: json(StagedRestoreSchema, "Restore staged for next startup"),
      ...errors,
    },
  });
  app.openAPIRegistry.registerPath({
    method: "delete",
    path: "/api/v1/system/restore",
    tags: ["system"],
    security: [{ sessionCookie: [] }],
    request: {
      headers: z.object({
        "x-bobarr-restore-confirmation": z.literal(CANCEL_CONFIRMATION),
      }),
    },
    responses: {
      200: json(CancelStagedRestoreSchema, "Staged restore cancelled"),
      ...errors,
    },
  });
}

function json(schema: z.ZodType, description: string) {
  return {
    content: { "application/json": { schema } },
    description,
  } as const;
}

function requireRestore(dependencies: ApiDependencies) {
  if (dependencies.restore === undefined) {
    throw new AppError({
      code: "service_unavailable",
      message: "Backup restore is unavailable",
      status: 503,
    });
  }
  return dependencies.restore;
}

function badRestore(message: string): AppError {
  return new AppError({
    code: "validation_failed",
    message,
    status: 422,
  });
}
