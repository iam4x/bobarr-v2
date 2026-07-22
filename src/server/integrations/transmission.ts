import { Buffer } from "node:buffer";

import {
  IntegrationError,
  type FetchLike,
  asFiniteNumber,
  asString,
  isRecord,
  parseJsonResponse,
  requestSignal,
} from "./http";

const DEFAULT_RPC_URL = "http://transmission:9091/transmission/rpc";
const DEFAULT_MINIMUM_RPC_VERSION = "6.0.0";
const DEFAULT_TIMEOUT_MS = 10_000;

const TORRENT_FIELDS = [
  "id",
  "hash_string",
  "name",
  "status",
  "error",
  "error_string",
  "eta",
  "percent_done",
  "metadata_percent_complete",
  "total_size",
  "size_when_done",
  "left_until_done",
  "rate_download",
  "rate_upload",
  "download_dir",
  "labels",
  "is_finished",
  "is_stalled",
  "files",
  "file_stats",
] as const;

export type TorrentStatus =
  | "stopped"
  | "queued-to-verify"
  | "verifying"
  | "queued-to-download"
  | "downloading"
  | "queued-to-seed"
  | "seeding"
  | "unknown";

export type TorrentFilePriority = "low" | "normal" | "high";

export interface TorrentFile {
  index: number;
  name: string;
  length: number;
  bytesCompleted: number;
  wanted: boolean;
  priority: TorrentFilePriority;
}

export interface TorrentSnapshot {
  hash: string;
  name: string;
  status: TorrentStatus;
  progress: number;
  metadataProgress: number;
  totalSize: number;
  sizeWhenDone: number;
  leftUntilDone: number;
  downloadRate: number;
  uploadRate: number;
  etaSeconds: number | null;
  downloadDirectory: string;
  labels: readonly string[];
  finished: boolean;
  stalled: boolean;
  error: string | null;
  files: readonly TorrentFile[];
}

export type TorrentSource =
  | { magnetUri: string; metainfo?: never }
  | { magnetUri?: never; metainfo: Uint8Array | string };

export interface AddTorrentOptions {
  downloadDirectory?: string;
  labels?: readonly string[];
  paused?: boolean;
  peerLimit?: number;
  wantedFiles?: readonly number[];
  unwantedFiles?: readonly number[];
}

export interface AddedTorrent {
  hash: string;
  name: string;
  duplicate: boolean;
}

export interface FileSelection {
  wanted?: readonly number[];
  unwanted?: readonly number[];
  priorityHigh?: readonly number[];
  priorityNormal?: readonly number[];
  priorityLow?: readonly number[];
}

export interface TransmissionHealth {
  version: string;
  rpcVersion: string;
  minimumRpcVersion: string;
}

export interface TorrentEngine {
  health(signal?: AbortSignal): Promise<TransmissionHealth>;
  add(
    source: TorrentSource,
    options?: AddTorrentOptions,
    signal?: AbortSignal,
  ): Promise<AddedTorrent>;
  get(hash: string, signal?: AbortSignal): Promise<TorrentSnapshot | null>;
  list(signal?: AbortSignal): Promise<readonly TorrentSnapshot[]>;
  selectFiles(
    hash: string,
    selection: FileSelection,
    signal?: AbortSignal,
  ): Promise<void>;
  start(hash: string, signal?: AbortSignal): Promise<void>;
  pause(hash: string, signal?: AbortSignal): Promise<void>;
  remove(
    hash: string,
    deleteData?: boolean,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface TransmissionClientOptions {
  rpcUrl?: string;
  username?: string;
  password?: string;
  minimumRpcVersion?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class TransmissionRpcError extends IntegrationError {
  readonly code: number;

  constructor(code: number, message: string, details?: unknown) {
    super("transmission", message, { details });
    this.name = "TransmissionRpcError";
    this.code = code;
  }
}

export class UnsupportedTransmissionError extends IntegrationError {
  readonly actualVersion: string;
  readonly requiredVersion: string;

  constructor(actualVersion: string, requiredVersion: string) {
    super(
      "transmission",
      `Transmission RPC ${actualVersion} is unsupported; ${requiredVersion} or newer is required`,
    );
    this.name = "UnsupportedTransmissionError";
    this.actualVersion = actualVersion;
    this.requiredVersion = requiredVersion;
  }
}

export function createTransmissionClient(
  options: TransmissionClientOptions = {},
): TorrentEngine {
  const rpcUrl = new URL(options.rpcUrl ?? DEFAULT_RPC_URL);
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minimumRpcVersion =
    options.minimumRpcVersion ?? DEFAULT_MINIMUM_RPC_VERSION;
  const authorization = createBasicAuthorization(
    options.username,
    options.password,
  );
  let sessionId: string | undefined;
  let requestId = 0;
  let compatible = false;
  let compatibilityCheck: Promise<void> | undefined;

  async function rpc(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const id = ++requestId;
    const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers = new Headers({
        accept: "application/json",
        "content-type": "application/json",
      });
      if (authorization) {
        headers.set("authorization", authorization);
      }
      if (sessionId) {
        headers.set("x-transmission-session-id", sessionId);
      }

      let response: Response;
      try {
        response = await fetcher(rpcUrl, {
          method: "POST",
          headers,
          body,
          signal: requestSignal(timeoutMs, signal),
        });
      } catch (error) {
        throw new IntegrationError(
          "transmission",
          "Transmission RPC request failed",
          { cause: error, retryable: true },
        );
      }

      if (response.status === 409 && attempt === 0) {
        const replacement = response.headers.get("x-transmission-session-id");
        if (!replacement) {
          throw new IntegrationError(
            "transmission",
            "Transmission rejected the session without returning a replacement token",
            { status: 409 },
          );
        }
        sessionId = replacement;
        continue;
      }

      if (!response.ok) {
        throw new IntegrationError(
          "transmission",
          `Transmission RPC returned HTTP ${response.status}`,
          {
            status: response.status,
            retryable: response.status >= 500,
          },
        );
      }

      const payload = await parseJsonResponse("transmission", response);
      if (!isRecord(payload)) {
        throw new IntegrationError(
          "transmission",
          "Transmission returned an invalid JSON-RPC response",
        );
      }
      const responseId = payload["id"];
      if (responseId !== id) {
        throw new IntegrationError(
          "transmission",
          "Transmission returned a mismatched JSON-RPC response id",
        );
      }
      const error = payload["error"];
      if (isRecord(error)) {
        const code = asFiniteNumber(error["code"]) ?? -1;
        const message = asString(error["message"]) ?? "Transmission RPC error";
        const detail = isRecord(error["data"])
          ? asString(error["data"]["error_string"])
          : undefined;
        throw new TransmissionRpcError(
          code,
          detail ? `${message}: ${detail}` : message,
          error["data"],
        );
      }
      const result = payload["result"];
      if (!isRecord(result)) {
        throw new IntegrationError(
          "transmission",
          "Transmission JSON-RPC response did not contain an object result",
        );
      }
      return result;
    }

    throw new IntegrationError(
      "transmission",
      "Transmission session negotiation failed",
    );
  }

  async function health(signal?: AbortSignal): Promise<TransmissionHealth> {
    const result = await rpc(
      "session_get",
      { fields: ["version", "rpc_version_semver"] },
      signal,
    );
    const version = asString(result["version"]);
    const rpcVersion = asString(result["rpc_version_semver"]);
    if (!version || !rpcVersion) {
      throw new IntegrationError(
        "transmission",
        "Transmission session response omitted version fields",
      );
    }
    if (compareSemver(rpcVersion, minimumRpcVersion) < 0) {
      throw new UnsupportedTransmissionError(rpcVersion, minimumRpcVersion);
    }
    compatible = true;
    return { version, rpcVersion, minimumRpcVersion };
  }

  async function ensureCompatible(signal?: AbortSignal): Promise<void> {
    if (compatible) return;
    compatibilityCheck ??= health(signal)
      .then(() => undefined)
      .catch((error) => {
        compatibilityCheck = undefined;
        throw error;
      });
    await compatibilityCheck;
  }

  async function getTorrents(
    hashes: readonly string[] | undefined,
    signal?: AbortSignal,
  ): Promise<readonly TorrentSnapshot[]> {
    await ensureCompatible(signal);
    const params: Record<string, unknown> = { fields: TORRENT_FIELDS };
    if (hashes) {
      params["ids"] = hashes.map(validateInfoHash);
    }
    const result = await rpc("torrent_get", params, signal);
    const torrents = result["torrents"];
    if (!Array.isArray(torrents)) {
      throw new IntegrationError(
        "transmission",
        "Transmission torrent response omitted torrents",
      );
    }
    return torrents.map(parseTorrentSnapshot);
  }

  return {
    health,

    async add(source, addOptions = {}, signal) {
      await ensureCompatible(signal);
      const params: Record<string, unknown> = {};
      if ("magnetUri" in source && source.magnetUri !== undefined) {
        params["filename"] = validateMagnetUri(source.magnetUri);
      } else if ("metainfo" in source && source.metainfo !== undefined) {
        params["metainfo"] = encodeMetainfo(source.metainfo);
      } else {
        throw new TypeError("A magnet URI or torrent metainfo is required");
      }
      if (addOptions.downloadDirectory !== undefined) {
        params["download_dir"] = addOptions.downloadDirectory;
      }
      if (addOptions.labels !== undefined) {
        params["labels"] = [...addOptions.labels];
      }
      if (addOptions.paused !== undefined) {
        params["paused"] = addOptions.paused;
      }
      if (addOptions.peerLimit !== undefined) {
        params["peer_limit"] = positiveInteger(
          addOptions.peerLimit,
          "peerLimit",
        );
      }
      if (addOptions.wantedFiles !== undefined) {
        params["files_wanted"] = validateFileIndexes(addOptions.wantedFiles);
      }
      if (addOptions.unwantedFiles !== undefined) {
        params["files_unwanted"] = validateFileIndexes(
          addOptions.unwantedFiles,
        );
      }
      const result = await rpc("torrent_add", params, signal);
      const added = result["torrent_added"];
      const duplicate = result["torrent_duplicate"];
      let torrent: Record<string, unknown> | undefined;
      if (isRecord(added)) {
        torrent = added;
      } else if (isRecord(duplicate)) {
        torrent = duplicate;
      }
      if (!torrent) {
        throw new IntegrationError(
          "transmission",
          "Transmission did not return the added torrent",
        );
      }
      const hash = asString(torrent["hash_string"]);
      const name = asString(torrent["name"]);
      if (!hash || !name) {
        throw new IntegrationError(
          "transmission",
          "Transmission returned an invalid added torrent",
        );
      }
      return { hash, name, duplicate: isRecord(duplicate) };
    },

    async get(hash, signal) {
      const torrents = await getTorrents([hash], signal);
      return torrents[0] ?? null;
    },

    list(signal) {
      return getTorrents(undefined, signal);
    },

    async selectFiles(hash, selection, signal) {
      await ensureCompatible(signal);
      const params: Record<string, unknown> = { ids: [validateInfoHash(hash)] };
      addFileIndexes(params, "files_wanted", selection.wanted);
      addFileIndexes(params, "files_unwanted", selection.unwanted);
      addFileIndexes(params, "priority_high", selection.priorityHigh);
      addFileIndexes(params, "priority_normal", selection.priorityNormal);
      addFileIndexes(params, "priority_low", selection.priorityLow);
      if (Object.keys(params).length === 1) {
        return;
      }
      await rpc("torrent_set", params, signal);
    },

    async start(hash, signal) {
      await ensureCompatible(signal);
      await rpc("torrent_start", { ids: [validateInfoHash(hash)] }, signal);
    },

    async pause(hash, signal) {
      await ensureCompatible(signal);
      await rpc("torrent_stop", { ids: [validateInfoHash(hash)] }, signal);
    },

    async remove(hash, deleteData = false, signal) {
      await ensureCompatible(signal);
      await rpc(
        "torrent_remove",
        {
          ids: [validateInfoHash(hash)],
          delete_local_data: deleteData,
        },
        signal,
      );
    },
  };
}

function parseTorrentSnapshot(value: unknown): TorrentSnapshot {
  if (!isRecord(value)) {
    throw new IntegrationError(
      "transmission",
      "Transmission returned an invalid torrent object",
    );
  }
  const hash = asString(value["hash_string"]);
  const name = asString(value["name"]);
  if (!hash || !name) {
    throw new IntegrationError(
      "transmission",
      "Transmission torrent omitted its hash or name",
    );
  }
  const rawFiles = Array.isArray(value["files"]) ? value["files"] : [];
  const rawStats = Array.isArray(value["file_stats"])
    ? value["file_stats"]
    : [];
  const files = rawFiles.map((file, index) =>
    parseTorrentFile(file, rawStats[index], index),
  );
  const errorString = asString(value["error_string"]);
  const errorCode = asFiniteNumber(value["error"]) ?? 0;
  const labels = Array.isArray(value["labels"])
    ? value["labels"].filter(
        (label): label is string => typeof label === "string",
      )
    : [];

  return {
    hash,
    name,
    status: parseTorrentStatus(asFiniteNumber(value["status"])),
    progress: boundedFraction(value["percent_done"]),
    metadataProgress: boundedFraction(value["metadata_percent_complete"]),
    totalSize: nonNegativeNumber(value["total_size"]),
    sizeWhenDone: nonNegativeNumber(value["size_when_done"]),
    leftUntilDone: nonNegativeNumber(value["left_until_done"]),
    downloadRate: nonNegativeNumber(value["rate_download"]),
    uploadRate: nonNegativeNumber(value["rate_upload"]),
    etaSeconds: parseEta(value["eta"]),
    downloadDirectory: asString(value["download_dir"]) ?? "",
    labels,
    finished: value["is_finished"] === true,
    stalled: value["is_stalled"] === true,
    error:
      errorCode === 0 ? null : errorString || `Transmission error ${errorCode}`,
    files,
  };
}

function parseTorrentFile(
  fileValue: unknown,
  statValue: unknown,
  index: number,
): TorrentFile {
  const file = isRecord(fileValue) ? fileValue : {};
  const stat = isRecord(statValue) ? statValue : {};
  const rawPriority = asFiniteNumber(stat["priority"]) ?? 0;
  return {
    index,
    name: asString(file["name"]) ?? `file-${index}`,
    length: nonNegativeNumber(file["length"]),
    bytesCompleted: nonNegativeNumber(
      stat["bytes_completed"] ?? file["bytes_completed"],
    ),
    wanted: stat["wanted"] === true || stat["wanted"] === 1,
    priority: parseFilePriority(rawPriority),
  };
}

function parseFilePriority(value: number): TorrentFilePriority {
  if (value < 0) return "low";
  if (value > 0) return "high";
  return "normal";
}

function parseTorrentStatus(value: number | undefined): TorrentStatus {
  const statuses: Record<number, TorrentStatus> = {
    0: "stopped",
    1: "queued-to-verify",
    2: "verifying",
    3: "queued-to-download",
    4: "downloading",
    5: "queued-to-seed",
    6: "seeding",
  };
  return value === undefined ? "unknown" : (statuses[value] ?? "unknown");
}

function parseEta(value: unknown): number | null {
  const eta = asFiniteNumber(value);
  return eta !== undefined && eta >= 0 && eta < 2_147_483_647 ? eta : null;
}

function boundedFraction(value: unknown): number {
  const number = asFiniteNumber(value) ?? 0;
  return Math.min(1, Math.max(0, number));
}

function nonNegativeNumber(value: unknown): number {
  return Math.max(0, asFiniteNumber(value) ?? 0);
}

function validateMagnetUri(value: string): string {
  if (value.length > 16_384) {
    throw new TypeError("Magnet URI is too long");
  }
  const url = new URL(value);
  if (url.protocol !== "magnet:") {
    throw new TypeError("Torrent source must use the magnet: scheme");
  }
  const exactTopics = url.searchParams.getAll("xt");
  if (
    !exactTopics.some((topic) =>
      /^(?:urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})|urn:btmh:1220[a-f\d]{64})$/i.test(
        topic,
      ),
    )
  ) {
    throw new TypeError("Magnet URI does not contain a supported torrent hash");
  }
  return value;
}

function validateInfoHash(hash: string): string {
  if (!/^(?:[a-f\d]{40}|[a-z2-7]{32}|1220[a-f\d]{64})$/i.test(hash)) {
    throw new TypeError("Invalid torrent info hash");
  }
  return hash;
}

function encodeMetainfo(metainfo: Uint8Array | string): string {
  if (typeof metainfo === "string") {
    if (!/^[a-z\d+/]+={0,2}$/i.test(metainfo) || metainfo.length % 4 !== 0) {
      throw new TypeError("Torrent metainfo must be valid base64");
    }
    return metainfo;
  }
  if (metainfo.byteLength === 0) {
    throw new TypeError("Torrent metainfo cannot be empty");
  }
  return Buffer.from(metainfo).toString("base64");
}

function addFileIndexes(
  target: Record<string, unknown>,
  field: string,
  indexes: readonly number[] | undefined,
): void {
  if (indexes !== undefined) {
    target[field] = validateFileIndexes(indexes);
  }
}

function validateFileIndexes(indexes: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const index of indexes) {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new TypeError("File indexes must be non-negative integers");
    }
    unique.add(index);
  }
  return [...unique].sort((left, right) => left - right);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function createBasicAuthorization(
  username: string | undefined,
  password: string | undefined,
): string | undefined {
  if (username === undefined && password === undefined) {
    return undefined;
  }
  if (!username || password === undefined) {
    throw new TypeError(
      "Transmission username and password must be configured together",
    );
  }
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

function parseSemver(value: string): readonly number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) {
    throw new TypeError(`Invalid semantic version: ${value}`);
  }
  return match.slice(1).map(Number);
}
