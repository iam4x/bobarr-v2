import { afterEach, describe, expect, it } from "bun:test";

import { api, ApiError, apiRequest, buildApiUrl } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildApiUrl", () => {
  it("prefixes versioned API paths and omits empty query values", () => {
    expect(
      buildApiUrl("catalog/search", {
        query: "Alien & Aliens",
        page: 2,
        kind: undefined,
        language: "",
        includeAdult: false,
      }),
    ).toBe(
      "/api/v1/catalog/search?query=Alien+%26+Aliens&page=2&includeAdult=false",
    );
  });

  it("does not prefix an already versioned contract path twice", () => {
    expect(buildApiUrl("/api/v1/system")).toBe("/api/v1/system");
  });
});

describe("typed API contract", () => {
  it("resolves and encodes named route params while preserving its method and body", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ updated: true });
    }) as typeof fetch;

    await expect(
      api.patch("selectDownloadFiles", {
        params: { id: "download/id" },
        body: { wanted: [2] },
      }),
    ).resolves.toEqual({ updated: true });
    expect(requestUrl).toBe("/api/v1/downloads/download%2Fid/files");
    expect(requestInit?.method).toBe("PATCH");
    expect(requestInit?.body).toBe(JSON.stringify({ wanted: [2] }));
  });

  it("encodes Activity job pagination and exact type filters", async () => {
    let requestUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestUrl = String(input);
      return Response.json({
        jobs: [],
        page: { limit: 20, offset: 40, total: 40 },
      });
    }) as typeof fetch;

    await api.get("listJobs", {
      query: {
        limit: 20,
        offset: 40,
        kind: "acquisition.organize-download",
      },
    });

    expect(requestUrl).toBe(
      "/api/v1/jobs?limit=20&offset=40&kind=acquisition.organize-download",
    );
  });
});

describe("apiRequest", () => {
  it("unwraps successful data envelopes and sends same-origin credentials", async () => {
    let credentials: RequestCredentials | undefined;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      credentials = init?.credentials;
      return Response.json({ data: { ready: true } });
    }) as typeof fetch;

    await expect(
      apiRequest<{ ready: boolean }>("/system/status"),
    ).resolves.toEqual({ ready: true });
    expect(credentials).toBe("same-origin");
  });

  it("turns standardized error envelopes into ApiError instances", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the form.",
            fieldErrors: { username: ["Already exists."] },
            requestId: "req_test",
          },
        },
        { status: 422 },
      )) as unknown as typeof fetch;

    try {
      await apiRequest("/setup", { method: "POST", body: { username: "bob" } });
      throw new Error("Expected the request to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("VALIDATION_ERROR");
      expect((error as ApiError).fieldErrors?.["username"]).toEqual([
        "Already exists.",
      ]);
      expect((error as ApiError).requestId).toBe("req_test");
    }
  });

  it("does not mistake a domain object's nullable error field for an envelope", async () => {
    const download = {
      id: "download-1",
      title: "A valid download",
      error: null,
    };
    globalThis.fetch = (async () =>
      Response.json(download)) as unknown as typeof fetch;

    await expect(apiRequest("/downloads")).resolves.toEqual(download);
  });
});
