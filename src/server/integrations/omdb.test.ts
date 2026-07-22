import type { FetchLike } from "./http";

import { describe, expect, test } from "bun:test";

import { IntegrationError } from "./http";
import { createOmdbClient } from "./omdb";

describe("OMDb adapter", () => {
  test("normalizes IMDb and Rotten Tomatoes ratings", async () => {
    let requestedUrl: URL | undefined;
    const fetcher: FetchLike = async (input, init) => {
      requestedUrl = new URL(String(input));
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return Response.json({
        imdbID: "tt0133093",
        imdbRating: "8.7",
        imdbVotes: "2,107,348",
        Ratings: [
          { Source: "Internet Movie Database", Value: "8.7/10" },
          { Source: "Rotten Tomatoes", Value: "83%" },
          { Source: "Metacritic", Value: "73/100" },
        ],
        Response: "True",
      });
    };
    const client = createOmdbClient({ apiKey: "secret-key", fetch: fetcher });

    await expect(client.ratings(" TT0133093 ")).resolves.toEqual({
      imdbId: "tt0133093",
      imdb: { value: 8.7, scale: 10, votes: 2_107_348 },
      rottenTomatoes: { value: 83, scale: 100 },
    });
    expect(requestedUrl?.searchParams.get("apikey")).toBe("secret-key");
    expect(requestedUrl?.searchParams.get("i")).toBe("tt0133093");
  });

  test("treats unavailable or malformed individual ratings as absent", async () => {
    const client = createOmdbClient({
      apiKey: "key",
      fetch: async () =>
        Response.json({
          imdbID: "tt0133093",
          imdbRating: "N/A",
          imdbVotes: "N/A",
          Ratings: [{ Source: "Rotten Tomatoes", Value: "not-a-percent" }],
          Response: "True",
        }),
    });

    await expect(client.ratings("tt0133093")).resolves.toEqual({
      imdbId: "tt0133093",
      imdb: null,
      rottenTomatoes: null,
    });
  });

  test("redacts the API key from upstream and network errors", async () => {
    const apiKey = "do-not-log-this-key";
    const rejected = createOmdbClient({
      apiKey,
      fetch: async () =>
        Response.json({
          Response: "False",
          Error: `Invalid API key ${apiKey}`,
        }),
    });
    const upstreamError = await rejected
      .ratings("tt0133093")
      .catch((error: unknown) => error);
    expect(upstreamError).toBeInstanceOf(IntegrationError);
    expect(String(upstreamError)).not.toContain(apiKey);

    const unavailable = createOmdbClient({
      apiKey,
      fetch: async (input) => {
        throw new Error(`Failed to fetch ${String(input)}`);
      },
    });
    const networkError = await unavailable
      .ratings("tt0133093")
      .catch((error: unknown) => error);
    expect(networkError).toBeInstanceOf(IntegrationError);
    expect(String(networkError)).not.toContain(apiKey);
    expect(String((networkError as Error).cause)).not.toContain(apiKey);
  });

  test("bounds requests with a timeout and marks transport errors retryable", async () => {
    const fetcher: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    const client = createOmdbClient({
      apiKey: "key",
      fetch: fetcher,
      timeoutMs: 5,
    });

    const error = await client
      .ratings("tt0133093")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({
      integration: "omdb",
      message: "OMDb request failed",
      retryable: true,
    });
  });

  test("rejects malformed IMDb identifiers before making a request", async () => {
    let calls = 0;
    const client = createOmdbClient({
      apiKey: "key",
      fetch: async () => {
        calls += 1;
        return Response.json({ Response: "True" });
      },
    });

    await expect(client.ratings("603")).rejects.toThrow("IMDb id");
    expect(calls).toBe(0);
  });
});
