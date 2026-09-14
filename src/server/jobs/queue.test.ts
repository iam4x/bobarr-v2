import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createSqliteJobQueue, durableJobToContract } from "./queue";
import { createJobWorker, JobDeferredError } from "./worker";
import { JobSchema } from "../../contracts/jobs";

describe("SQLite durable job queue", () => {
  test("defers an import during a volume transfer without exhausting retries", async () => {
    let timestamp = 1_000;
    let transferring = true;
    const queue = createSqliteJobQueue({
      database: new Database(":memory:"),
      now: () => timestamp,
    });
    const worker = createJobWorker({
      queue,
      now: () => timestamp,
      handlers: {
        import: async () => {
          if (transferring) throw new JobDeferredError("Season is being moved");
        },
      },
    });
    try {
      const job = await queue.enqueue({
        type: "import",
        payload: {},
        maxAttempts: 1,
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(await worker.runOnce()).toBe(true);
        expect(await queue.get(job.id)).toMatchObject({
          state: "queued",
          attempt: 0,
        });
        expect(await worker.runOnce()).toBe(false);
        timestamp += 5_000;
      }
      transferring = false;
      expect(await worker.runOnce()).toBe(true);
      expect(await queue.get(job.id)).toMatchObject({
        state: "completed",
        attempt: 1,
      });
    } finally {
      queue.close();
    }
  });

  test("a long volume job renews its lease while another worker runs", async () => {
    const queue = createSqliteJobQueue({ database: new Database(":memory:") });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const renewed = Promise.withResolvers<void>();
    const heartbeat = queue.heartbeat.bind(queue);
    let heartbeats = 0;
    queue.heartbeat = async (...args) => {
      await heartbeat(...args);
      heartbeats += 1;
      if (heartbeats >= 4) renewed.resolve();
    };
    const organizer = createJobWorker({
      queue,
      leaseMs: 90,
      handlers: {
        "library.organize.v1": async () => {
          entered.resolve();
          await release.promise;
        },
      },
    });
    const ordinary = createJobWorker({
      queue,
      handlers: { "maintenance.cleanup.v1": async () => {} },
    });
    const moving = await queue.enqueue({
      type: "library.organize.v1",
      payload: {},
    });
    const maintenance = await queue.enqueue({
      type: "maintenance.cleanup.v1",
      payload: {},
    });
    const running = organizer.runOnce();
    try {
      await entered.promise;
      await renewed.promise;
      expect(await queue.requeueExpired()).toBe(0);
      expect(await ordinary.runOnce()).toBe(true);
      expect(await queue.get(maintenance.id)).toMatchObject({
        state: "completed",
      });
      expect(await queue.get(moving.id)).toMatchObject({
        state: "running",
        attempt: 1,
      });
    } finally {
      release.resolve();
      await running;
      queue.close();
    }
  });

  test("deduplicates active jobs and recovers expired leases", async () => {
    let currentTime = 1_000;
    let id = 0;
    const queue = createSqliteJobQueue({
      database: new Database(":memory:"),
      now: () => currentTime,
      id: () => `id-${++id}`,
    });
    const first = await queue.enqueue({
      type: "torrent.refresh",
      payload: { hash: "abc" },
      dedupeKey: "abc",
    });
    const duplicate = await queue.enqueue({
      type: "torrent.refresh",
      payload: { hash: "abc" },
      dedupeKey: "abc",
    });
    expect(duplicate.id).toBe(first.id);
    expect(await queue.count({ states: ["queued"] })).toBe(1);
    expect(await queue.list({ limit: 1, offset: 0 })).toHaveLength(1);

    const claimed = await queue.claim({ workerId: "one", leaseMs: 100 });
    expect(claimed).toMatchObject({ state: "running", attempt: 1 });
    currentTime += 101;
    expect(await queue.requeueExpired()).toBe(1);
    expect(await queue.get(first.id)).toMatchObject({ state: "queued" });
    queue.close();
  });

  test("filters by type and keeps equal-timestamp pages deterministic", async () => {
    let id = 0;
    const queue = createSqliteJobQueue({
      database: new Database(":memory:"),
      now: () => 1_500,
      id: () => `job-${++id}`,
    });
    await queue.enqueue({ type: "library.scan.v1", payload: { order: 1 } });
    await queue.enqueue({ type: "library.scan.v1", payload: { order: 2 } });
    await queue.enqueue({ type: "media.acquire.v1", payload: { order: 3 } });

    const firstPage = await queue.list({
      types: ["library.scan.v1"],
      limit: 1,
      offset: 0,
    });
    const secondPage = await queue.list({
      types: ["library.scan.v1"],
      limit: 1,
      offset: 1,
    });

    expect(firstPage.map((job) => job.id)).toEqual(["job-2"]);
    expect(secondPage.map((job) => job.id)).toEqual(["job-1"]);
    expect(await queue.count({ types: ["library.scan.v1"] })).toBe(2);
    queue.close();
  });

  test("worker persists success and retries failures", async () => {
    let currentTime = 2_000;
    const queue = createSqliteJobQueue({
      database: new Database(":memory:"),
      now: () => currentTime,
    });
    const handled: string[] = [];
    const worker = createJobWorker({
      queue,
      now: () => currentTime,
      handlers: {
        organize: async (job) => {
          const payload = job.payload as { name: string; fail?: boolean };
          if (payload.fail && job.attempt === 1) throw new Error("transient");
          handled.push(payload.name);
        },
      },
    });
    const successful = await queue.enqueue({
      type: "organize",
      payload: { name: "movie" },
    });
    const retrying = await queue.enqueue({
      type: "organize",
      payload: { name: "episode", fail: true },
    });
    expect(await worker.runOnce()).toBe(true);
    const completed = await queue.get(successful.id);
    expect(completed).toMatchObject({
      state: "completed",
    });
    expect(JobSchema.parse(durableJobToContract(completed!)).status).toBe(
      "completed",
    );
    expect(await worker.runOnce()).toBe(true);
    expect(await queue.get(retrying.id)).toMatchObject({
      state: "queued",
      attempt: 1,
    });
    currentTime += 1_000;
    expect(await worker.runOnce()).toBe(true);
    expect(await queue.get(retrying.id)).toMatchObject({ state: "completed" });
    expect((await queue.logs(retrying.id)).map(({ event }) => event)).toEqual([
      "job.queued",
      "job.started",
      "job.retry_scheduled",
      "job.started",
      "job.completed",
    ]);
    expect(handled).toEqual(["movie", "episode"]);
    queue.close();
  });

  test("drain stops claiming new jobs after graceful shutdown begins", async () => {
    const queue = createSqliteJobQueue({
      database: new Database(":memory:"),
    });
    let acceptingWork = true;
    const handled: string[] = [];
    const worker = createJobWorker({
      queue,
      handlers: {
        organize: async (job) => {
          handled.push((job.payload as { name: string }).name);
          acceptingWork = false;
        },
      },
    });
    await queue.enqueue({ type: "organize", payload: { name: "first" } });
    await queue.enqueue({ type: "organize", payload: { name: "second" } });

    expect(
      await worker.drain({
        maxJobs: 10,
        shouldContinue: () => acceptingWork,
      }),
    ).toBe(1);
    expect(handled).toEqual(["first"]);
    expect(await queue.count({ states: ["queued"] })).toBe(1);
    queue.close();
  });

  test("redacts protected torrent data from persisted job failures", async () => {
    const queue = createSqliteJobQueue({
      database: new Database(":memory:"),
    });
    const worker = createJobWorker({
      queue,
      handlers: {
        acquire: async () => {
          throw new Error(
            "Invalid URL: magnet:?xt=urn:btih:abc&tr=https://tracker.test?passkey=do-not-store",
          );
        },
      },
    });
    const job = await queue.enqueue({
      type: "acquire",
      payload: { version: 1 },
      maxAttempts: 1,
    });

    await worker.runOnce();

    const failed = await queue.get(job.id);
    expect(failed?.state).toBe("failed");
    expect(failed?.lastError).toBe("Error: Invalid URL: [redacted magnet]");
    expect(failed?.lastError).not.toContain("do-not-store");
    const failureLog = (await queue.logs(job.id)).at(-1);
    expect(failureLog).toMatchObject({
      level: "error",
      event: "job.failed",
      message: "Error: Invalid URL: [redacted magnet]",
    });
    queue.close();
  });

  test("cancels and aborts active work without turning it into a failure", async () => {
    const queue = createSqliteJobQueue({ database: new Database(":memory:") });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const worker = createJobWorker({
      queue,
      handlers: {
        acquire: async (_job, context) => {
          markStarted?.();
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(context.signal.reason),
              { once: true },
            );
          });
        },
      },
    });
    const job = await queue.enqueue({
      type: "acquire",
      payload: { version: 1 },
    });
    const running = worker.runOnce();
    await started;

    expect(await worker.cancel(job.id)).toBe(true);
    expect(await running).toBe(true);
    expect(await queue.get(job.id)).toMatchObject({
      state: "cancelled",
      lastError: null,
    });
    queue.close();
  });
});
