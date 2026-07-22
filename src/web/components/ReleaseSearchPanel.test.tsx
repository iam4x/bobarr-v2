import { describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { ReleaseCard, ReleaseSearchPanel } from "./ReleaseSearchPanel";

describe("responsive release result", () => {
  test("shows safe candidate metadata and exclusion reasons", () => {
    const markup = renderToStaticMarkup(
      <ReleaseCard
        release={{
          id: `rel_${"a".repeat(43)}`,
          title: "Example.Show.S01E02.1080p.WEB-DL",
          indexer: "Example Indexer",
          size: 1_000_000_000,
          seeders: 20,
          score: -1,
          eligible: false,
          reasons: ["media is not released until tomorrow"],
          ...({
            source: "magnet:?xt=urn:btih:secret&passkey=do-not-render",
          } as object),
        }}
        isGrabbing={false}
        onGrab={() => undefined}
      />,
    );

    expect(markup).toContain("release-card--rejected");
    expect(markup).toContain("Excluded");
    expect(markup).toContain("media is not released until tomorrow");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("magnet:?");
    expect(markup).not.toContain("passkey");
  });

  test("renders an editable Jackett query without weakening target binding", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ReleaseSearchPanel
          target={{ tmdbId: 1399, kind: "series", season: 4, episode: 2 }}
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("Jackett search query");
    expect(markup).toContain("Search Jackett");
    expect(markup).toContain('maxLength="300"');
    expect(markup).toContain("candidate binding still use");
  });

  test("labels an active-media candidate as an explicit replacement", () => {
    const markup = renderToStaticMarkup(
      <ReleaseCard
        release={{
          id: `rel_${"b".repeat(43)}`,
          mediaId: "11111111-1111-4111-8111-111111111111",
          title: "Example.Movie.2026.1080p.WEB-DL",
          indexer: "Example Indexer",
          size: 2_000_000_000,
          seeders: 50,
          score: 100,
          eligible: true,
          reasons: [],
        }}
        replacement
        isGrabbing={false}
        onGrab={() => undefined}
      />,
    );

    expect(markup).toContain("Replace");
    expect(markup).toContain(
      'class="badge badge--success release-card__score"',
    );
    expect(markup).toContain("release-card__action");
    expect(markup).not.toContain(">Grab<");
  });

  test("hides eligible score calculations while keeping exclusion reasons", () => {
    const eligibleMarkup = renderToStaticMarkup(
      <ReleaseCard
        release={{
          id: `rel_${"c".repeat(43)}`,
          title: "Example.Movie.2026.1080p.WEB-DL",
          indexer: "Example Indexer",
          size: 2_000_000_000,
          seeders: 50,
          score: 212,
          eligible: true,
          reasons: ["title match +30", "swarm health +23"],
        }}
        isGrabbing={false}
        onGrab={() => undefined}
      />,
    );

    expect(eligibleMarkup).toContain("Score 212");
    expect(eligibleMarkup).not.toContain("title match +30");
    expect(eligibleMarkup).not.toContain("swarm health +23");
  });
});
