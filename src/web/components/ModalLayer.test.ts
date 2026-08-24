import { describe, expect, test } from "bun:test";

import { __modalLayerTesting } from "./ModalLayer";

const slowPrevious = { clientY: 100, atMs: 0 };

describe("sheet release policy", () => {
  test("restores short and upward drags", () => {
    expect(
      __modalLayerTesting.decideSheetRelease({
        offsetPx: 23,
        previous: slowPrevious,
        current: { clientY: 105, atMs: 20 },
        sheetHeightPx: 600,
      }),
    ).toEqual({ kind: "restore" });
    expect(
      __modalLayerTesting.decideSheetRelease({
        offsetPx: 0,
        previous: slowPrevious,
        current: { clientY: 80, atMs: 20 },
        sheetHeightPx: 600,
      }),
    ).toEqual({ kind: "restore" });
  });

  test("dismisses after the bounded distance threshold", () => {
    expect(
      __modalLayerTesting.decideSheetRelease({
        offsetPx: 180,
        previous: slowPrevious,
        current: { clientY: 280, atMs: 500 },
        sheetHeightPx: 900,
      }),
    ).toEqual({ kind: "dismiss", reason: "distance" });
  });

  test("dismisses a short drag only with enough downward velocity", () => {
    expect(
      __modalLayerTesting.decideSheetRelease({
        offsetPx: 30,
        previous: { clientY: 100, atMs: 0 },
        current: { clientY: 130, atMs: 30 },
        sheetHeightPx: 600,
      }),
    ).toEqual({ kind: "dismiss", reason: "velocity" });
    expect(
      __modalLayerTesting.decideSheetRelease({
        offsetPx: 30,
        previous: { clientY: 100, atMs: 0 },
        current: { clientY: 130, atMs: 100 },
        sheetHeightPx: 600,
      }),
    ).toEqual({ kind: "restore" });
  });
});
