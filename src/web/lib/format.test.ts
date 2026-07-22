import { describe, expect, it } from "bun:test";

import {
  formatBytes,
  formatEta,
  imageUrl,
  mediaYear,
  toPercent,
} from "./format";

describe("frontend display formatters", () => {
  it("builds correctly sized TMDB image URLs", () => {
    expect(imageUrl("/poster.jpg", "w342")).toBe(
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );
    expect(imageUrl("https://cdn.example/poster.jpg")).toBe(
      "https://cdn.example/poster.jpg",
    );
  });

  it("formats bytes, ETAs, years, and normalized progress", () => {
    expect(formatBytes(1_500_000_000)).toBe("1.50 GB");
    expect(formatEta(3_900)).toBe("1h 5m");
    expect(mediaYear({ releaseDate: "1999-03-31" })).toBe("1999");
    expect(toPercent(0.453)).toBe(45);
    expect(toPercent(135)).toBe(100);
  });
});
