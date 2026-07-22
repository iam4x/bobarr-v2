import type { BackendConfig } from "../config";
import type { BackendRuntime } from "./initialize";

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeBackend } from "./initialize";
import { ApiErrorEnvelopeSchema, AuthSessionSchema } from "../../contracts";
import { createEncryptionKey } from "../config";

const nativeFetch = globalThis.fetch;
const runtimes: BackendRuntime[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
  globalThis.fetch = nativeFetch;
});

describe("library scan review API", () => {
  test("persists ambiguous scanner results with restart-safe candidate summaries", async () => {
    const fixture = await createFixture();
    const handler = fixture.runtime.acquisition.handlers["library.scan.v1"];
    if (handler === undefined) throw new Error("Missing library scan handler");
    const now = Date.now();

    await handler(
      {
        id: crypto.randomUUID(),
        type: "library.scan.v1",
        payload: { version: 1, roots: [fixture.moviesRoot] },
        state: "running",
        dedupeKey: null,
        priority: 0,
        attempt: 1,
        maxAttempts: 5,
        runAt: now,
        leaseOwner: "test",
        leaseToken: "test-lease",
        leaseExpiresAt: now + 60_000,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      {
        signal: new AbortController().signal,
        heartbeat: () => Promise.resolve(),
      },
    );

    const result = fixture.runtime.repositories.scanReviews.list({
      status: "pending",
      kind: "movie",
      limit: 50,
      offset: 0,
    });
    expect(result.total).toBe(1);
    expect(result.reviews[0]).toMatchObject({
      title: "Matrix",
      year: 1999,
      rootPath: fixture.moviesRoot,
      files: [{ path: fixture.movieFile, sizeBytes: 5 }],
      candidates: [
        { tmdbId: 603, title: "Matrix" },
        { tmdbId: 604, title: "Matrix" },
      ],
      status: "pending",
    });
  });

  test("requires authentication and resolves a recorded candidate idempotently", async () => {
    const fixture = await createFixture();
    const review = fixture.runtime.repositories.scanReviews.upsert({
      kind: "movie",
      title: "Matrix",
      year: 1999,
      rootPath: fixture.moviesRoot,
      files: [{ path: fixture.movieFile, sizeBytes: 5 }],
      candidates: [matrixCandidate(603, "The Matrix")],
    });
    const session = await setup(fixture.runtime);

    const unauthenticated = await fixture.runtime.app.request(
      "/api/v1/library/scan-reviews",
    );
    expect(unauthenticated.status).toBe(401);

    const list = await fixture.runtime.app.request(
      "/api/v1/library/scan-reviews?status=pending&kind=movie",
      { headers: { cookie: session.cookie } },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      reviews: [{ id: review.id, status: "pending" }],
      page: { total: 1 },
    });

    const invalidChoice = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/scan-reviews/${review.id}/resolve`,
      { tmdbId: 999 },
      session,
    );
    expect(invalidChoice.status).toBe(400);
    expect(
      ApiErrorEnvelopeSchema.parse(await invalidChoice.json()).error.code,
    ).toBe("bad_request");

    const resolved = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/scan-reviews/${review.id}/resolve`,
      { tmdbId: 603 },
      session,
    );
    expect(resolved.status).toBe(200);
    const resolvedBody = (await resolved.json()) as {
      status: string;
      mediaItemId: string;
    };
    expect(resolvedBody).toMatchObject({ status: "resolved" });
    expect(
      fixture.runtime.repositories.media.get(resolvedBody.mediaItemId),
    ).toMatchObject({
      tmdbId: 603,
      title: "The Matrix",
      acquisitionState: "available",
      monitorPolicy: "none",
    });
    expect(
      fixture.runtime.repositories.libraryFiles.listForMedia(
        resolvedBody.mediaItemId,
      ),
    ).toHaveLength(1);

    await unlink(fixture.movieFile);
    const repeated = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/scan-reviews/${review.id}/resolve`,
      { tmdbId: 603 },
      session,
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      id: review.id,
      status: "resolved",
      mediaItemId: resolvedBody.mediaItemId,
    });
  });

  test("rejects a recorded file that is outside the configured root", async () => {
    const fixture = await createFixture();
    const escapedFile = join(fixture.baseDirectory, "outside.mkv");
    await Bun.write(escapedFile, "unsafe");
    const review = fixture.runtime.repositories.scanReviews.upsert({
      kind: "movie",
      title: "Unsafe Matrix",
      year: 1999,
      rootPath: fixture.moviesRoot,
      files: [{ path: escapedFile, sizeBytes: 6 }],
      candidates: [matrixCandidate(604, "Unsafe Matrix")],
    });
    const session = await setup(fixture.runtime);

    const response = await jsonRequest(
      fixture.runtime,
      `/api/v1/library/scan-reviews/${review.id}/resolve`,
      { tmdbId: 604 },
      session,
    );
    expect(response.status).toBe(409);
    expect(
      ApiErrorEnvelopeSchema.parse(await response.json()).error.message,
    ).toContain("escapes its configured root");
    expect(
      fixture.runtime.repositories.scanReviews.get(review.id)?.status,
    ).toBe("pending");
  });
});

function matrixCandidate(tmdbId: number, title: string) {
  return {
    tmdbId,
    kind: "movie" as const,
    title,
    year: 1999,
    posterPath: "/matrix.jpg",
    overview: "A hacker discovers the nature of reality.",
  };
}

async function createFixture(): Promise<{
  runtime: BackendRuntime;
  baseDirectory: string;
  moviesRoot: string;
  movieFile: string;
}> {
  const baseDirectory = await realpath(
    await mkdtemp(join(tmpdir(), "bobarr-scan-review-")),
  );
  temporaryDirectories.push(baseDirectory);
  const moviesRoot = join(baseDirectory, "movies");
  const movieDirectory = join(moviesRoot, "Matrix (1999)");
  const movieFile = join(movieDirectory, "Matrix.1999.mkv");
  await mkdir(movieDirectory, { recursive: true });
  await Bun.write(movieFile, "movie");

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/search/multi")) {
      return Response.json({
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          tmdbSearchResult(603, "Matrix"),
          tmdbSearchResult(604, "Matrix"),
        ],
      });
    }
    const tmdbId = Number(url.pathname.split("/").at(-1));
    return Response.json({
      id: tmdbId,
      title: tmdbId === 603 ? "The Matrix" : "Unsafe Matrix",
      original_title: "The Matrix",
      overview: "A hacker discovers the nature of reality.",
      original_language: "en",
      release_date: "1999-03-30",
      poster_path: "/matrix.jpg",
      backdrop_path: "/matrix-backdrop.jpg",
      popularity: 100,
      vote_average: 8.2,
      vote_count: 25_000,
      genres: [{ id: 878, name: "Science Fiction" }],
      runtime: 136,
      status: "Released",
    });
  }) as typeof globalThis.fetch;
  const config: BackendConfig = {
    environment: "test",
    version: "test",
    databasePath: ":memory:",
    encryptionKey: createEncryptionKey(),
    sessionCookieName: "bobarr_session",
    sessionTtlSeconds: 3_600,
    sessionCookieSecure: false,
    loginFailureLimit: 5,
    loginLockSeconds: 60,
  };
  const runtime = await initializeBackend({
    config,
    environment: { NODE_ENV: "test", TMDB_API_KEY: "tmdb-test-key" },
  });
  runtimes.push(runtime);
  runtime.repositories.settings.update({
    storage: {
      ...runtime.repositories.settings.ensureDefaults().settings.storage,
      moviesPath: moviesRoot,
      televisionPath: join(baseDirectory, "tv"),
    },
  });
  return { runtime, baseDirectory, moviesRoot, movieFile };
}

function tmdbSearchResult(id: number, title: string) {
  return {
    id,
    media_type: "movie",
    title,
    original_title: title,
    overview: `${title} overview`,
    original_language: "en",
    release_date: "1999-03-30",
    poster_path: `/poster-${id}.jpg`,
    backdrop_path: null,
    popularity: 10,
    vote_average: 7,
    vote_count: 100,
    genre_ids: [878],
  };
}

async function setup(runtime: BackendRuntime): Promise<{
  cookie: string;
  csrfToken: string;
}> {
  const response = await runtime.app.request("/api/v1/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "correct-horse-battery-staple",
    }),
  });
  const session = AuthSessionSchema.parse(await response.json());
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Expected session cookie");
  return {
    cookie: setCookie.split(";", 1)[0] ?? "",
    csrfToken: session.csrfToken,
  };
}

function jsonRequest(
  runtime: BackendRuntime,
  path: string,
  body: unknown,
  session: { cookie: string; csrfToken: string },
): Promise<Response> {
  return Promise.resolve(
    runtime.app.request(path, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify(body),
    }),
  );
}
