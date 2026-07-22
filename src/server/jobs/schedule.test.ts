import { describe, expect, test } from "bun:test";

import { nextCronOccurrence, validateCronExpression } from "./schedule";

describe("maintenance schedule decisions", () => {
  test("finds stepped and daily UTC occurrences", () => {
    const after = new Date("2026-07-21T01:57:31.000Z");
    expect(nextCronOccurrence("*/15 * * * *", after).toISOString()).toBe(
      "2026-07-21T02:00:00.000Z",
    );
    expect(nextCronOccurrence("0 3 * * *", after).toISOString()).toBe(
      "2026-07-21T03:00:00.000Z",
    );
  });

  test("supports ranges, lists, and Sunday aliases", () => {
    const friday = new Date("2026-07-24T18:00:00.000Z");
    expect(nextCronOccurrence("30 8-10 * * 0,7", friday).toISOString()).toBe(
      "2026-07-26T08:30:00.000Z",
    );
  });

  test("rejects malformed or out-of-range schedules", () => {
    expect(validateCronExpression("0 */6 * * *")).toBe(true);
    expect(validateCronExpression("60 4 * * *")).toBe(false);
    expect(validateCronExpression("not-a-cron")).toBe(false);
  });
});
