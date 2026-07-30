import { initializeBackend } from "./server/api";
import { parseShutdownTimeout, settleByDeadline } from "./server/core";
import { DEFAULT_RESTORE_MAX_BYTES } from "./server/operations";
import indexHtml from "./web/index.html";
import icon192 from "./web/pwa/app-icon-192.png" with { type: "file" };
import icon512 from "./web/pwa/app-icon-512.png" with { type: "file" };
import appleTouchIcon from "./web/pwa/apple-touch-icon.png" with { type: "file" };
import { NO_CACHE_HEADERS, SERVICE_WORKER_SOURCE } from "./web/pwa/config";

for (const file of indexHtml.files ?? []) {
  file.headers["cache-control"] = NO_CACHE_HEADERS["cache-control"];
  file.headers["expires"] = NO_CACHE_HEADERS.expires;
  file.headers["pragma"] = NO_CACHE_HEADERS.pragma;
}

const port = parsePort(process.env["PORT"]);
const hostname = process.env["HOST"] ?? "0.0.0.0";
const shutdownTimeoutMs = parseShutdownTimeout(
  process.env["BOBARR_SHUTDOWN_TIMEOUT_MS"],
);
const runtime = await initializeBackend();
const logger = runtime.logger;
let shuttingDown = false;

const server = Bun.serve({
  hostname,
  port,
  development: runtime.config.environment === "development",
  maxRequestBodySize: DEFAULT_RESTORE_MAX_BYTES,
  routes: {
    "/health/live": () =>
      Response.json({ status: "ok", version: runtime.config.version }),
    "/health/ready": () => {
      if (shuttingDown) {
        return Response.json({ status: "stopping" }, { status: 503 });
      }
      try {
        runtime.database.sqlite.query("SELECT 1").get();
        return Response.json({
          status: "ready",
          migrationVersion: runtime.database.migrationVersion,
        });
      } catch {
        return Response.json({ status: "unavailable" }, { status: 503 });
      }
    },
    "/api/v1/events": (request, bunServer) => {
      bunServer.timeout(request, 0);
      return runtime.app.fetch(request);
    },
    "/api/*": (request) => runtime.app.fetch(request),
    "/service-worker.js": () =>
      new Response(SERVICE_WORKER_SOURCE, {
        headers: {
          ...NO_CACHE_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
          "service-worker-allowed": "/",
        },
      }),
    "/pwa/icon-192.png": () =>
      new Response(Bun.file(icon192), {
        headers: { ...NO_CACHE_HEADERS, "content-type": "image/png" },
      }),
    "/pwa/icon-512.png": () =>
      new Response(Bun.file(icon512), {
        headers: { ...NO_CACHE_HEADERS, "content-type": "image/png" },
      }),
    "/pwa/apple-touch-icon.png": () =>
      new Response(Bun.file(appleTouchIcon), {
        headers: { ...NO_CACHE_HEADERS, "content-type": "image/png" },
      }),
    "/*": indexHtml,
  },
  error(error) {
    const requestId = crypto.randomUUID();
    logger.error("http.unhandled_error", { error, requestId });
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "An unexpected error occurred",
          requestId,
        },
      },
      { status: 500 },
    );
  },
});

logger.info("server.started", {
  hostname,
  port: server.port,
  setupRequired: !runtime.auth.isSetupComplete(),
});

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadlineAt = Date.now() + shutdownTimeoutMs;
  logger.info("server.stopping", { signal, shutdownTimeoutMs });
  runtime.beginShutdown();

  let httpForced = false;
  try {
    const http = await settleByDeadline(server.stop(false), deadlineAt);
    if (!http.settled) {
      httpForced = true;
      logger.warn("server.shutdown_deadline_expired", {
        phase: "http",
        shutdownTimeoutMs,
      });
      await server.stop(true);
    } else if (http.error !== undefined) {
      logger.error("server.http_stop_failed", { error: http.error });
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error("server.http_stop_failed", { error });
    process.exitCode = 1;
  }

  let backgroundForced = false;
  try {
    const runtimeClose = await runtime.close({ deadlineAt });
    backgroundForced = runtimeClose.forced;
    if (runtimeClose.forced) {
      logger.warn("server.shutdown_deadline_expired", {
        phase: "background-work",
        shutdownTimeoutMs,
      });
    }
  } catch (error) {
    logger.error("server.runtime_close_failed", { error });
    process.exitCode = 1;
  } finally {
    logger.info("server.stopped", {
      forced: httpForced || backgroundForced,
    });
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 3000);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}
