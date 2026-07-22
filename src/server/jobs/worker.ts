import type { Logger } from "../core";
import type { DurableJob, EnqueueJob, JobQueue } from "./queue";

export interface JobHandlerContext {
  signal: AbortSignal;
  heartbeat(): Promise<void>;
}

export type JobHandler<T = unknown> = (
  job: DurableJob<T>,
  context: JobHandlerContext,
) => Promise<void>;

export interface JobWorkerOptions {
  queue: JobQueue;
  handlers: Readonly<Record<string, JobHandler>>;
  workerId?: string;
  leaseMs?: number;
  retryDelay?: (job: DurableJob, error: unknown, now: number) => number;
  now?: () => number;
  logger?: Logger;
}

export interface ReconcileResult {
  recoveredLeases: number;
  jobs: readonly DurableJob[];
}

export interface JobWorker {
  runOnce(signal?: AbortSignal): Promise<boolean>;
  cancel(id: string, now?: number): Promise<boolean>;
  drain(options?: {
    maxJobs?: number;
    signal?: AbortSignal;
    shouldContinue?: () => boolean;
  }): Promise<number>;
  reconcile(jobs: readonly EnqueueJob[]): Promise<ReconcileResult>;
}

export function createJobWorker(options: JobWorkerOptions): JobWorker {
  const workerId = options.workerId ?? `bobarr-${crypto.randomUUID()}`;
  const leaseMs = options.leaseMs ?? 60_000;
  const now = options.now ?? Date.now;
  const activeControllers = new Map<string, AbortController>();
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError("Worker leaseMs must be a positive integer");
  }
  const types = Object.keys(options.handlers);
  if (types.length === 0)
    throw new TypeError("Worker needs at least one handler");

  async function runOnce(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const job = await options.queue.claim({
      workerId,
      leaseMs,
      now: now(),
      types,
    });
    if (!job) return false;
    const leaseToken = job.leaseToken;
    if (!leaseToken)
      throw new Error(`Claimed job ${job.id} has no lease token`);
    const handler = options.handlers[job.type];
    const jobLogger = options.logger?.child({
      jobId: job.id,
      jobType: job.type,
      attempt: job.attempt,
      workerId,
    });
    if (!handler) {
      jobLogger?.error("job.handler_missing");
      await options.queue.fail(
        job.id,
        leaseToken,
        new Error("No job handler"),
        {
          retryAt: Number.MAX_SAFE_INTEGER,
          now: now(),
        },
      );
      return true;
    }
    const controller = new AbortController();
    activeControllers.set(job.id, controller);
    const forwardAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      jobLogger?.info("job.started");
      await handler(job, {
        signal: controller.signal,
        heartbeat: () =>
          options.queue.heartbeat(job.id, leaseToken, leaseMs, now()),
      });
      await options.queue.complete(job.id, leaseToken, now());
      jobLogger?.info("job.completed");
    } catch (error) {
      const current = await options.queue.get(job.id);
      if (current?.state === "cancelled") {
        jobLogger?.info("job.cancelled");
        return true;
      }
      const timestamp = now();
      const delay = options.retryDelay?.(job, error, timestamp);
      await options.queue.fail(job.id, leaseToken, error, {
        retryAt:
          delay === undefined ? undefined : timestamp + Math.max(0, delay),
        now: timestamp,
      });
      jobLogger?.warn("job.failed", {
        error,
        retryAt:
          delay === undefined ? undefined : timestamp + Math.max(0, delay),
      });
    } finally {
      activeControllers.delete(job.id);
      signal?.removeEventListener("abort", forwardAbort);
    }
    return true;
  }

  return {
    runOnce,

    async cancel(id, timestamp = now()) {
      const cancelled = await options.queue.cancel(id, timestamp);
      if (cancelled) {
        activeControllers
          .get(id)
          ?.abort(
            new DOMException("Job cancelled by administrator", "AbortError"),
          );
      }
      return cancelled;
    },

    async drain({ maxJobs = 100, signal, shouldContinue } = {}) {
      if (!Number.isSafeInteger(maxJobs) || maxJobs <= 0) {
        throw new TypeError("maxJobs must be a positive integer");
      }
      let processed = 0;
      while (processed < maxJobs) {
        if (shouldContinue?.() === false) break;
        if (!(await runOnce(signal))) break;
        processed += 1;
      }
      return processed;
    },

    async reconcile(jobs) {
      const recoveredLeases = await options.queue.requeueExpired(now());
      const ensured: DurableJob[] = [];
      for (const job of jobs) ensured.push(await options.queue.enqueue(job));
      return { recoveredLeases, jobs: ensured };
    },
  };
}
