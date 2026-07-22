export const DEFAULT_GRACEFUL_SHUTDOWN_MS = 15_000;
export const MAX_GRACEFUL_SHUTDOWN_MS = 300_000;

export interface DeadlineSettlement {
  settled: boolean;
  error?: unknown;
}

export function parseShutdownTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_GRACEFUL_SHUTDOWN_MS;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_GRACEFUL_SHUTDOWN_MS
  ) {
    throw new TypeError(
      `BOBARR_SHUTDOWN_TIMEOUT_MS must be an integer between 1 and ${MAX_GRACEFUL_SHUTDOWN_MS}`,
    );
  }
  return parsed;
}

/** Waits for work without allowing it to reject outside the caller's control. */
export async function settleByDeadline(
  work: PromiseLike<unknown>,
  deadlineAt: number,
): Promise<DeadlineSettlement> {
  const remaining = Math.max(0, deadlineAt - Date.now());
  if (remaining === 0) return { settled: false };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const settlement = Promise.resolve(work).then(
    (): DeadlineSettlement => ({ settled: true }),
    (error: unknown): DeadlineSettlement => ({ settled: true, error }),
  );
  const deadline = new Promise<DeadlineSettlement>((resolve) => {
    timeout = setTimeout(() => resolve({ settled: false }), remaining);
  });
  const result = await Promise.race([settlement, deadline]);
  if (timeout !== undefined) clearTimeout(timeout);
  return result;
}
