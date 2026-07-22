import { describe, expect, test } from "bun:test";

import {
  DEFAULT_GRACEFUL_SHUTDOWN_MS,
  parseShutdownTimeout,
  settleByDeadline,
} from "./shutdown";

describe("graceful shutdown helpers", () => {
  test("validates the configurable bounded timeout", () => {
    expect(parseShutdownTimeout(undefined)).toBe(DEFAULT_GRACEFUL_SHUTDOWN_MS);
    expect(parseShutdownTimeout("2500")).toBe(2_500);
    expect(() => parseShutdownTimeout("0")).toThrow();
    expect(() => parseShutdownTimeout("not-a-number")).toThrow();
  });

  test("distinguishes settled, failed, and expired work", async () => {
    expect(await settleByDeadline(Promise.resolve(), Date.now() + 100)).toEqual(
      { settled: true },
    );

    const failure = new Error("failed");
    expect(
      await settleByDeadline(Promise.reject(failure), Date.now() + 100),
    ).toEqual({ settled: true, error: failure });

    expect(
      await settleByDeadline(new Promise(() => undefined), Date.now()),
    ).toEqual({ settled: false });
  });
});
