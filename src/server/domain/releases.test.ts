import { describe, expect, test } from "bun:test";

import {
  inspectRelease,
  normalizeReleaseTitle,
  rankReleases,
  scoreRelease,
} from "./releases";

describe("release normalization and scoring", () => {
  test("extracts common release metadata", () => {
    expect(
      inspectRelease(
        "Example.Show.S02E03.2160p.WEB-DL.DV.HDR10+.HEVC.TrueHD.Atmos-GRP",
      ),
    ).toMatchObject({
      quality: "2160p",
      source: "web-dl",
      codec: "x265",
      hdr: "dolby-vision",
      season: 2,
      episode: 3,
      releaseGroup: "GRP",
    });
  });

  test("folds Latin ligatures and non-decomposing letters to ASCII", () => {
    const examples = [
      ["cœur", "coeur"],
      ["encyclopædia", "encyclopaedia"],
      ["Straße", "strasse"],
      ["smørrebrød", "smorrebrod"],
      ["Łódź", "lodz"],
      ["Þingvellir", "thingvellir"],
      ["Ĳsselmeer", "ijsselmeer"],
      ["oﬃce", "office"],
    ] as const;

    for (const [title, expected] of examples) {
      expect(normalizeReleaseTitle(title)).toBe(expected);
    }
  });

  test("matches French ligatures with ASCII release titles", () => {
    const result = scoreRelease(
      {
        id: "lost-bus",
        title:
          "The.Lost.Bus.Au.Coeur.Des.Flammes.2025.MULTI.VFF.1080p.WEBRip.EAC3.5.1.x265-TyHD",
        sizeBytes: 2_000_000_000,
        seeders: 20,
      },
      {
        kind: "movie",
        title: "The Lost Bus - Au cœur des flammes",
        year: 2025,
      },
    );

    expect(result.eligible).toBe(true);
    expect(result.exclusions).not.toContain(
      "release title does not match the requested media",
    );
  });

  test("matches apostrophes with dot-separated release titles", () => {
    const result = scoreRelease(
      {
        id: "300-rise-of-an-empire",
        title:
          "300.La.Naissance.d.un.Empire.2014.MULTI.VFF.1080p.BluRay.HDLight.AC3.5.1.x265-Winks",
        sizeBytes: 2_000_000_000,
        seeders: 20,
      },
      {
        kind: "movie",
        title: "300\u00a0: La Naissance d’un Empire 2014",
        year: 2014,
      },
    );

    expect(result.eligible).toBe(true);
    expect(result.exclusions).not.toContain(
      "release title does not match the requested media",
    );
  });

  test("excludes wrong media identity and blocked terms", () => {
    const result = scoreRelease(
      {
        id: "wrong",
        title: "Example.Show.S02E04.1080p.WEB-DL.x264-RARBG",
        sizeBytes: 2_000_000_000,
        seeders: 20,
        indexer: "example",
      },
      { kind: "episode", title: "Example Show", season: 2, episode: 3 },
      { excludedTerms: ["RARBG"] },
    );
    expect(result.eligible).toBe(false);
    expect(result.exclusions).toContain("release episode 4 does not match 3");
    expect(result.exclusions).toContain("excluded term present: RARBG");
  });

  test("ranks deterministically with custom quality preferences", () => {
    const releases = [
      {
        id: "720",
        title: "Dune.2021.720p.BluRay.x264-A",
        sizeBytes: 1_000,
        seeders: 100,
      },
      {
        id: "1080",
        title: "Dune.2021.1080p.WEB-DL.x265-B",
        sizeBytes: 2_000,
        seeders: 10,
      },
    ];
    const ranked = rankReleases(
      releases,
      { kind: "movie", title: "Dune", year: 2021 },
      { qualityOrder: ["1080p", "720p"] },
    );
    expect(ranked[0]?.candidate.id).toBe("1080");
    expect(ranked.every(({ eligible }) => eligible)).toBe(true);
  });

  test("hard-excludes media before its release or air date", () => {
    const result = scoreRelease(
      {
        id: "future",
        title: "Example.Show.S02E03.1080p.WEB-DL.x265-GRP",
        sizeBytes: 2_000_000_000,
        seeders: 50,
      },
      {
        kind: "episode",
        title: "Example Show",
        season: 2,
        episode: 3,
        releaseDate: "2030-06-01T20:00:00.000Z",
      },
      { now: Date.parse("2030-06-01T19:59:59.000Z") },
    );

    expect(result.eligible).toBe(false);
    expect(result.exclusions).toContain(
      "media is not released until 2030-06-01T20:00:00.000Z",
    );
  });

  test("requires every configured release term", () => {
    const missing = scoreRelease(
      {
        id: "missing-required",
        title: "Dune.2021.1080p.WEB-DL.x265-GRP",
        sizeBytes: 2_000_000_000,
        seeders: 50,
      },
      { kind: "movie", title: "Dune", year: 2021 },
      { requiredTerms: ["proper", "x265"] },
    );
    const complete = scoreRelease(
      {
        id: "all-required",
        title: "Dune.2021.PROPER.1080p.WEB-DL.x265-GRP",
        sizeBytes: 2_000_000_000,
        seeders: 50,
      },
      { kind: "movie", title: "Dune", year: 2021 },
      { requiredTerms: ["proper", "x265"] },
    );

    expect(missing.exclusions).toContain("required term missing: proper");
    expect(missing.eligible).toBe(false);
    expect(complete.eligible).toBe(true);
  });
});
