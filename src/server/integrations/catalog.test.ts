import { describe, expect, test } from "bun:test";

import { IntegrationError, type FetchLike } from "./http";
import { createJackettClient, parseTorznabFeed } from "./jackett";
import { createTmdbClient } from "./tmdb";

describe("TMDB adapter", () => {
  test("normalizes multi-search results and filters people", async () => {
    let requestedUrl = "";
    const fetcher: FetchLike = async (input, init) => {
      requestedUrl = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token",
      );
      return Response.json({
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 10,
            media_type: "movie",
            title: "Dune",
            original_title: "Dune",
            release_date: "2021-10-22",
            genre_ids: [12],
            vote_average: 8.1,
          },
          { id: 20, media_type: "person", name: "Someone" },
        ],
      });
    };
    const client = createTmdbClient({ accessToken: "token", fetch: fetcher });
    const page = await client.search(" Dune ", { language: "en-US" });

    expect(page.results).toHaveLength(1);
    expect(page.results[0]).toMatchObject({
      mediaType: "movie",
      tmdbId: 10,
      title: "Dune",
      year: 2021,
    });
    expect(requestedUrl).toContain("query=Dune");
    expect(requestedUrl).toContain("language=en-US");
  });

  test("normalizes genre and language configuration", async () => {
    const fetcher: FetchLike = async (input) => {
      const path = new URL(String(input)).pathname;
      return path.includes("configuration/languages")
        ? Response.json([
            { iso_639_1: "fr", english_name: "French", name: "Français" },
            { iso_639_1: "en", english_name: "English", name: "English" },
          ])
        : Response.json({ genres: [{ id: 18, name: "Drama" }] });
    };
    const client = createTmdbClient({ apiKey: "key", fetch: fetcher });

    await expect(
      client.genres("movie", { language: "fr-FR" }),
    ).resolves.toEqual([{ id: 18, name: "Drama" }]);
    await expect(client.languages()).resolves.toEqual([
      { code: "en", englishName: "English", name: "English" },
      { code: "fr", englishName: "French", name: "Français" },
    ]);
  });

  test("maps bounded discover filters to movie and TV parameters", async () => {
    const requests: URL[] = [];
    const client = createTmdbClient({
      apiKey: "key",
      fetch: async (input) => {
        requests.push(new URL(String(input)));
        return Response.json({
          page: 1,
          total_pages: 1,
          total_results: 0,
          results: [],
        });
      },
    });

    await client.discover("movie", {
      page: 2,
      language: "fr-FR",
      region: "FR",
      genres: [18, 878, 18],
      genreMode: "any",
      originCountry: "ca",
      originalLanguage: "fr",
      year: 2024,
      minimumRuntimeMinutes: 80,
      maximumRuntimeMinutes: 180,
      minimumVoteCount: 0,
      minimumVoteAverage: 7.5,
      sortBy: "release_date.desc",
    });
    await client.discover("tv", {
      language: "en-US",
      region: "US",
      originCountry: "gb",
      originalLanguage: "en",
      dateFrom: "2020-01-01",
      dateTo: "2024-12-31",
      sortBy: "vote_average.desc",
    });

    const movie = requests[0]!.searchParams;
    expect(requests[0]?.pathname).toBe("/3/discover/movie");
    expect(movie.get("page")).toBe("2");
    expect(movie.get("region")).toBe("FR");
    expect(movie.get("with_genres")).toBe("18|878");
    expect(movie.get("with_origin_country")).toBe("CA");
    expect(movie.get("with_original_language")).toBe("fr");
    expect(movie.get("primary_release_year")).toBe("2024");
    expect(movie.get("with_runtime.gte")).toBe("80");
    expect(movie.get("with_runtime.lte")).toBe("180");
    expect(movie.get("vote_count.gte")).toBe("0");
    expect(movie.get("vote_average.gte")).toBe("7.5");
    expect(movie.get("sort_by")).toBe("primary_release_date.desc");

    const television = requests[1]!.searchParams;
    expect(requests[1]?.pathname).toBe("/3/discover/tv");
    expect(television.has("region")).toBe(false);
    expect(television.get("first_air_date.gte")).toBe("2020-01-01");
    expect(television.get("first_air_date.lte")).toBe("2024-12-31");
    expect(television.get("vote_count.gte")).toBe("200");
    expect(television.get("sort_by")).toBe("vote_average.desc");
  });

  test("normalizes TMDB pagination to the public supported range", async () => {
    const client = createTmdbClient({
      apiKey: "key",
      fetch: async () =>
        Response.json({
          page: 0,
          total_pages: 10_000,
          total_results: 0,
          results: [],
        }),
    });

    await expect(client.discover("movie")).resolves.toMatchObject({
      page: 1,
      totalPages: 500,
      totalResults: 0,
    });
  });

  test("rejects incompatible discover ranges and media sorts", async () => {
    const client = createTmdbClient({
      apiKey: "key",
      fetch: async () => {
        throw new Error("Invalid discovery must not make a request");
      },
    });

    await expect(
      client.discover("tv", { sortBy: "revenue.desc" }),
    ).rejects.toThrow("not supported for tv");
    await expect(
      client.discover("movie", {
        minimumRuntimeMinutes: 180,
        maximumRuntimeMinutes: 90,
      }),
    ).rejects.toThrow("minimum runtime");
    await expect(
      client.discover("movie", {
        year: 2024,
        dateFrom: "2024-01-01",
      }),
    ).rejects.toThrow("either year or a date range");
  });

  test("normalizes localized TMDB country configuration", async () => {
    let requestedUrl: URL | undefined;
    const client = createTmdbClient({
      apiKey: "key",
      fetch: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json([
          {
            iso_3166_1: "US",
            english_name: "United States of America",
            native_name: "United States",
          },
          {
            iso_3166_1: "FR",
            english_name: "France",
            native_name: "France",
          },
        ]);
      },
    });

    await expect(client.countries({ language: "fr-FR" })).resolves.toEqual([
      { code: "FR", englishName: "France", nativeName: "France" },
      {
        code: "US",
        englishName: "United States of America",
        nativeName: "United States",
      },
    ]);
    expect(requestedUrl?.pathname).toBe("/3/configuration/countries");
    expect(requestedUrl?.searchParams.get("language")).toBe("fr-FR");
  });

  test("loads title-specific recommendations", async () => {
    let requestedPath = "";
    const fetcher: FetchLike = async (input) => {
      requestedPath = new URL(String(input)).pathname;
      return Response.json({
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [
          {
            id: 11,
            title: "Arrival",
            original_title: "Arrival",
            release_date: "2016-11-11",
          },
        ],
      });
    };
    const client = createTmdbClient({ apiKey: "key", fetch: fetcher });

    const page = await client.recommendations("movie", 10, {
      language: "en",
      region: "US",
    });

    expect(requestedPath).toBe("/3/movie/10/recommendations");
    expect(page.results[0]).toMatchObject({ tmdbId: 11, title: "Arrival" });
  });

  test("loads a TV title IMDb id through TMDB external ids", async () => {
    let requestedUrl: URL | undefined;
    const client = createTmdbClient({
      apiKey: "key",
      fetch: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json({
          id: 1399,
          name: "Game of Thrones",
          original_name: "Game of Thrones",
          first_air_date: "2011-04-17",
          genres: [{ id: 18, name: "Drama" }],
          external_ids: { imdb_id: "tt0944947" },
        });
      },
    });

    const details = await client.details("tv", 1399);

    expect(details.externalId).toBe("tt0944947");
    expect(requestedUrl?.searchParams.get("append_to_response")).toBe(
      "external_ids",
    );
  });
});

describe("Jackett adapter", () => {
  const xml = `<?xml version="1.0"?>
    <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
      <channel>
        <torznab:response offset="0" total="1" />
        <item>
          <title><![CDATA[Dune.2021.1080p.WEB-DL.x265-GRP]]></title>
          <guid>release-1</guid>
          <link>http://jackett:9117/dl/release-1</link>
          <pubDate>Tue, 21 Jul 2026 10:00:00 GMT</pubDate>
          <enclosure url="http://jackett:9117/dl/release-1" length="1234" type="application/x-bittorrent" />
          <torznab:attr name="seeders" value="42" />
          <torznab:attr name="peers" value="5" />
          <torznab:attr name="category" value="2000" />
          <torznab:attr name="indexer" value="Example" />
          <torznab:attr name="infohash" value="0123456789abcdef0123456789abcdef01234567" />
        </item>
      </channel>
    </rss>`;

  test("parses Torznab results", () => {
    const page = parseTorznabFeed(xml);
    expect(page.total).toBe(1);
    expect(page.results[0]).toMatchObject({
      title: "Dune.2021.1080p.WEB-DL.x265-GRP",
      seeders: 42,
      peers: 5,
      sizeBytes: 1234,
      categories: [2000],
      indexer: "Example",
    });
  });

  test("queries Jackett and only downloads metadata from its origin", async () => {
    const fetcher: FetchLike = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("torznab")) return new Response(xml);
      return new Response(new Uint8Array([100, 52, 58, 105]), {
        headers: { "content-type": "application/x-bittorrent" },
      });
    };
    const client = createJackettClient({ apiKey: "key", fetch: fetcher });
    const page = await client.search({ query: "Dune", categories: [2000] });
    expect(page.results).toHaveLength(1);
    await expect(
      client.downloadTorrent("http://jackett:9117/dl/release-1"),
    ).resolves.toEqual(new Uint8Array([100, 52, 58, 105]));
    await expect(
      client.downloadTorrent("http://attacker.invalid/file.torrent"),
    ).rejects.toThrow("only be fetched from Jackett");
  });

  test("accepts real indexer and namespaced capability XML variants", async () => {
    const documents = [
      `<?xml version="1.0" encoding="UTF-8"?>
        <indexers>
          <indexer id="example" configured="true">
            <title>Example</title>
            <caps><server title="Jackett" /></caps>
          </indexer>
        </indexers>`,
      `\uFEFF<!-- generated by Jackett -->
        <torznab:caps xmlns:torznab="http://torznab.com/schemas/2015/feed">
          <torznab:server title="Jackett" />
        </torznab:caps>`,
      `<?xml version="1.0"?><rss version="2.0"><channel /></rss>`,
    ];

    for (const document of documents) {
      const client = createJackettClient({
        apiKey: "key",
        fetch: async () =>
          new Response(document, {
            headers: { "content-type": "application/xml" },
          }),
      });
      await expect(client.health()).resolves.toBeUndefined();
    }
  });

  test("normalizes copied Jackett URLs without trusting embedded credentials", async () => {
    const requestedUrls: URL[] = [];
    const fetcher: FetchLike = async (input) => {
      requestedUrls.push(new URL(String(input)));
      return new Response("<indexers />", {
        headers: { "content-type": "text/xml" },
      });
    };
    const copiedFeed = createJackettClient({
      apiKey: "current-key",
      baseUrl:
        "https://media.example/jackett/api/v2.0/indexers/all/results/torznab/api?apikey=stale-key&t=caps#fragment",
      fetch: fetcher,
    });
    const copiedDashboard = createJackettClient({
      apiKey: "current-key",
      baseUrl: "https://media.example/jackett/UI/Dashboard",
      fetch: fetcher,
    });

    await copiedFeed.health();
    await copiedDashboard.health();

    expect(
      requestedUrls.map((url) => ({
        pathname: url.pathname,
        apiKeys: url.searchParams.getAll("apikey"),
        type: url.searchParams.get("t"),
        configured: url.searchParams.get("configured"),
        hash: url.hash,
      })),
    ).toEqual([
      {
        pathname: "/jackett/api/v2.0/indexers/all/results/torznab/api",
        apiKeys: ["current-key"],
        type: "indexers",
        configured: "true",
        hash: "",
      },
      {
        pathname: "/jackett/api/v2.0/indexers/all/results/torznab/api",
        apiKeys: ["current-key"],
        type: "indexers",
        configured: "true",
        hash: "",
      },
    ]);
    expect(() =>
      createJackettClient({
        apiKey: "key",
        baseUrl: "https://user:password@media.example/jackett",
      }),
    ).toThrow("must not contain credentials");
  });

  test("rejects HTML pages that merely contain capability-like markup", async () => {
    const client = createJackettClient({
      apiKey: "key",
      fetch: async () =>
        new Response("<html><body><caps></caps></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });

    await expect(client.health()).rejects.toThrow(
      "invalid Torznab capability response",
    );
  });

  test("maps HTTP-200 Torznab error envelopes without exposing descriptions", async () => {
    const healthSecret = "health-api-key-that-must-not-leak";
    const healthClient = createJackettClient({
      apiKey: healthSecret,
      fetch: async () =>
        new Response(
          `<error code="100" description="Incorrect API key: ${healthSecret}" />`,
          { headers: { "content-type": "application/xml" } },
        ),
    });
    const healthError = await healthClient.health().catch((error) => error);

    expect(healthError).toBeInstanceOf(IntegrationError);
    expect(healthError).toMatchObject({
      message: "Jackett rejected the API key",
      status: 401,
      retryable: false,
      details: { torznabCode: "100" },
    });
    expect(String(healthError)).not.toContain(healthSecret);
    expect(JSON.stringify(healthError)).not.toContain(healthSecret);

    const searchClient = createJackettClient({
      apiKey: "key",
      fetch: async (input) => {
        const query = new URL(String(input)).searchParams.get("q");
        return new Response(
          query === "unsupported"
            ? '<error code="203" description="Function unavailable for private-query" />'
            : '<error code="500" description="Limit reached for tracker passkey" />',
          { headers: { "content-type": "text/xml" } },
        );
      },
    });
    const unsupportedError = await searchClient
      .search({ query: "unsupported" })
      .catch((error) => error);
    const limitedError = await searchClient
      .search({ query: "limited" })
      .catch((error) => error);

    expect(unsupportedError).toMatchObject({
      message: "The requested Jackett search function is unavailable",
      status: 422,
      retryable: false,
      details: { torznabCode: "203" },
    });
    expect(String(unsupportedError)).not.toContain("private-query");
    expect(limitedError).toMatchObject({
      message: "Jackett request limit was reached",
      status: 429,
      retryable: true,
      details: { torznabCode: "500" },
    });
    expect(String(limitedError)).not.toContain("tracker passkey");
  });
});
