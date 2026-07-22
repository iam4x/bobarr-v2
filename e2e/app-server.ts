import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const allowedRoot = resolve("/tmp/bobarr-e2e");
const root = resolve(process.env["BOBARR_E2E_ROOT"] ?? allowedRoot);
const rootRelativeToAllowed = relative(allowedRoot, root);
if (
  rootRelativeToAllowed.startsWith("..") ||
  isAbsolute(rootRelativeToAllowed)
) {
  throw new TypeError("BOBARR_E2E_ROOT must remain under /tmp/bobarr-e2e");
}

const appPort = parsePort(process.env["PORT"] ?? "3100", "PORT");
const controlPort = parsePort(
  process.env["BOBARR_E2E_CONTROL_PORT"] ?? "3102",
  "BOBARR_E2E_CONTROL_PORT",
);
const controlToken = process.env["BOBARR_E2E_CONTROL_TOKEN"];
if (!controlToken || controlToken.length < 24) {
  throw new TypeError(
    "BOBARR_E2E_CONTROL_TOKEN must contain at least 24 characters",
  );
}

await rm(root, { recursive: true, force: true });
await Promise.all(
  ["config", "media/downloads", "media/movies", "media/tv"].map((path) =>
    mkdir(join(root, path), { recursive: true }),
  ),
);

type AppChild = Bun.Subprocess<"ignore", "inherit", "inherit">;
type SupervisorState =
  | "starting"
  | "ready"
  | "restarting"
  | "exited"
  | "stopping";

let child: AppChild | null = null;
let generation = 0;
let state: SupervisorState = "starting";
let unexpectedExitCode: number | null = null;
let restartPromise: Promise<SupervisorSnapshot> | null = null;
let stopping = false;

interface SupervisorSnapshot {
  generation: number;
  pid: number | null;
  state: SupervisorState;
  unexpectedExitCode: number | null;
}

function snapshot(): SupervisorSnapshot {
  return {
    generation,
    pid: child?.pid ?? null,
    state,
    unexpectedExitCode,
  };
}

function spawnApp(): AppChild {
  generation += 1;
  unexpectedExitCode = null;
  const spawned = Bun.spawn([process.execPath, "e2e/app-child.ts"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  child = spawned;
  void spawned.exited.then((exitCode) => {
    if (child !== spawned || stopping || state === "restarting") return;
    state = "exited";
    unexpectedExitCode = exitCode;
  });
  return spawned;
}

async function waitForAppReady(expected: AppChild): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (expected.exitCode !== null) {
      throw new Error(
        `Bobarr child exited before becoming ready (code ${expected.exitCode})`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/health/ready`, {
        cache: "no-store",
      });
      if (response.ok) return;
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(50);
  }
  throw new Error("Bobarr child did not become ready within 15 seconds", {
    cause: lastError,
  });
}

async function stopApp(expected: AppChild): Promise<void> {
  if (expected.exitCode !== null) return;
  expected.kill("SIGTERM");
  const exitedGracefully = await Promise.race([
    expected.exited.then(() => true),
    Bun.sleep(8_000).then(() => false),
  ]);
  if (!exitedGracefully && expected.exitCode === null) {
    expected.kill("SIGKILL");
    await expected.exited;
  }
}

async function restartApp(): Promise<SupervisorSnapshot> {
  state = "restarting";
  const previous = child;
  if (previous) await stopApp(previous);
  if (stopping) throw new Error("Bobarr supervisor is stopping");
  const next = spawnApp();
  try {
    await waitForAppReady(next);
    state = "ready";
    return snapshot();
  } catch (error) {
    await stopApp(next);
    if (child === next) child = null;
    state = "exited";
    throw error;
  }
}

const initialChild = spawnApp();
void waitForAppReady(initialChild)
  .then(() => {
    if (child === initialChild && state === "starting") state = "ready";
  })
  .catch(() => {
    if (child === initialChild) state = "exited";
  });

const controlServer = Bun.serve({
  hostname: "127.0.0.1",
  port: controlPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json(snapshot(), {
        status: state === "exited" ? 503 : 200,
      });
    }
    if (url.pathname !== "/__control/restart") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }
    if (request.headers.get("x-bobarr-e2e-control-token") !== controlToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      restartPromise ??= restartApp().finally(() => {
        restartPromise = null;
      });
      return Response.json(await restartPromise);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Restart failed",
          ...snapshot(),
        },
        { status: 500 },
      );
    }
  },
});

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  state = "stopping";
  await controlServer.stop(false);
  const active = child;
  if (active) await stopApp(active);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function parsePort(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}
