import type { FetchLike } from "./http";

import { describe, expect, test } from "bun:test";

import {
  UnsupportedTransmissionError,
  createTransmissionClient,
} from "./transmission";

const HASH = "0123456789abcdef0123456789abcdef01234567";

describe("Transmission JSON-RPC adapter", () => {
  test("negotiates the CSRF token and enforces the RPC version", async () => {
    const headers: string[] = [];
    let calls = 0;
    const fetcher: FetchLike = async (_input, init) => {
      calls += 1;
      const requestHeaders = new Headers(init?.headers);
      headers.push(requestHeaders.get("x-transmission-session-id") ?? "");
      if (calls === 1) {
        return new Response(null, {
          status: 409,
          headers: { "x-transmission-session-id": "session-token" },
        });
      }
      const body = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(body.id, {
        version: "4.1.3",
        rpc_version_semver: "6.0.1",
      });
    };
    const client = createTransmissionClient({
      fetch: fetcher,
      username: "bobarr",
      password: "secret",
    });

    await expect(client.health()).resolves.toEqual({
      version: "4.1.3",
      rpcVersion: "6.0.1",
      minimumRpcVersion: "6.0.0",
    });
    expect(headers).toEqual(["", "session-token"]);
  });

  test("rejects an old Transmission RPC contract", async () => {
    const fetcher = rpcFetcher(() => ({
      version: "4.0.6",
      rpc_version_semver: "5.3.0",
    }));
    const client = createTransmissionClient({ fetch: fetcher });
    await expect(client.health()).rejects.toBeInstanceOf(
      UnsupportedTransmissionError,
    );
  });

  test("adds, reads, selects, starts, pauses, and removes by hash", async () => {
    const methods: { method: string; params: Record<string, unknown> }[] = [];
    const fetcher = rpcFetcher((request) => {
      methods.push({ method: request.method, params: request.params });
      if (request.method === "session_get") {
        return {
          version: "4.1.3",
          rpc_version_semver: "6.0.1",
        };
      }
      if (request.method === "torrent_add") {
        return {
          torrent_added: { hash_string: HASH, name: "Example" },
        };
      }
      if (request.method === "torrent_get") {
        return {
          torrents: [
            {
              hash_string: HASH,
              name: "Example",
              status: 4,
              percent_done: 0.5,
              metadata_percent_complete: 1,
              total_size: 100,
              size_when_done: 80,
              left_until_done: 40,
              rate_download: 10,
              rate_upload: 2,
              eta: 4,
              download_dir: "/downloads/example",
              labels: ["bobarr:download"],
              is_finished: false,
              is_stalled: false,
              error: 0,
              files: [{ name: "video.mkv", length: 80 }],
              file_stats: [{ bytes_completed: 40, wanted: true, priority: 1 }],
            },
          ],
        };
      }
      return {};
    });
    const client = createTransmissionClient({ fetch: fetcher });

    await expect(
      client.add(
        { magnetUri: `magnet:?xt=urn:btih:${HASH}` },
        { labels: ["bobarr:download"], paused: true },
      ),
    ).resolves.toEqual({ hash: HASH, name: "Example", duplicate: false });
    const torrent = await client.get(HASH);
    expect(torrent?.status).toBe("downloading");
    expect(torrent?.files[0]).toMatchObject({
      wanted: true,
      priority: "high",
      bytesCompleted: 40,
    });
    await expect(client.list()).resolves.toHaveLength(1);
    await client.selectFiles(HASH, {
      wanted: [2, 0, 2],
      unwanted: [1],
      priorityHigh: [0],
    });
    await client.start(HASH);
    await client.pause(HASH);
    await client.remove(HASH, true);

    expect(methods.map(({ method }) => method)).toEqual([
      "session_get",
      "torrent_add",
      "torrent_get",
      "torrent_get",
      "torrent_set",
      "torrent_start",
      "torrent_stop",
      "torrent_remove",
    ]);
    expect(methods[4]?.params["files_wanted"]).toEqual([0, 2]);
    expect(methods[7]?.params["delete_local_data"]).toBe(true);
  });
});

interface RpcRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

function rpcFetcher(
  result: (request: RpcRequest) => Record<string, unknown>,
): FetchLike {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as RpcRequest;
    return rpcResponse(request.id, result(request));
  };
}

function rpcResponse(id: number, result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}
