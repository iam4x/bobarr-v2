import { describe, expect, test } from "bun:test";

import {
  aggregateChildAcquisitionState,
  organizedEpisodeNumbers,
} from "./media-state";

describe("media hierarchy state", () => {
  test("does not report a partially available season as available", () => {
    expect(
      aggregateChildAcquisitionState([
        { monitorPolicy: "selected", acquisitionState: "available" },
        { monitorPolicy: "selected", acquisitionState: "missing" },
        { monitorPolicy: "none", acquisitionState: "failed" },
      ]),
    ).toBe("missing");
    expect(
      aggregateChildAcquisitionState([
        { monitorPolicy: "selected", acquisitionState: "available" },
        { monitorPolicy: "selected", acquisitionState: "available" },
      ]),
    ).toBe("available");
  });

  test("extracts every episode in multi-episode source files", () => {
    expect([...organizedEpisodeNumbers(["Show.S02E01E02.mkv"], 2)]).toEqual([
      1, 2,
    ]);
    expect([...organizedEpisodeNumbers(["Show.S03E01.mkv"], 2)]).toEqual([]);
  });
});
