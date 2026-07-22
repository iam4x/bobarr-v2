import type { DurableJob, JobHandler } from "../jobs";
import type {
  AcquisitionDependencies,
  CandidateSearchInput,
  CandidateSearchResult,
  CandidateSource,
  DownloadRecord,
  DownloadState,
  DownloadView,
  IndexerRelease,
  NewStoredCandidate,
  ProtectedCandidate,
  ReconciliationResult,
  StoredCandidate,
  TorrentInput,
  TorrentSnapshot,
} from "./ports";

import { Buffer } from "node:buffer";
import { posix } from "node:path";

import {
  normalizeReleaseTitle,
  rankReleases,
  type ReleaseTarget,
} from "../domain/releases";

export const ADD_TORRENT_JOB = "acquisition.add-torrent";
export const ORGANIZE_DOWNLOAD_JOB = "acquisition.organize-download";
export const CANDIDATE_TTL_MS = 30 * 60_000;

const DEFAULT_DOWNLOAD_ROOT = "/downloads";
const DEFAULT_MAX_METAINFO_BYTES = 10 * 1024 * 1024;
const ORGANIZATION_ERROR_PREFIX = "Organization failed: ";

export interface AcquisitionServiceOptions {
  downloadRoot?: string;
  maxMetainfoBytes?: number;
  defaultPeerLimit?: number;
  now?: () => number;
  id?: () => string;
}

export interface AddOptions {
  paused?: boolean;
  peerLimit?: number;
}

export interface ManualDownloadInput extends AddOptions {
  target: ReleaseTarget;
  title?: string;
}

export interface AcquisitionService {
  searchCandidates(input: CandidateSearchInput): Promise<CandidateSearchResult>;
  startFromCandidate(
    candidateId: string,
    options?: AddOptions,
  ): Promise<DownloadView>;
  startFromMagnet(
    input: ManualDownloadInput & { magnetUri: string },
  ): Promise<DownloadView>;
  startFromMetainfo(
    input: ManualDownloadInput & { metainfo: Uint8Array },
  ): Promise<DownloadView>;
  retryDownload(downloadId: string): Promise<DownloadView>;
  runAddJob(downloadId: string, signal?: AbortSignal): Promise<void>;
  runOrganizeJob(downloadId: string, signal?: AbortSignal): Promise<void>;
  reconcile(signal?: AbortSignal): Promise<ReconciliationResult>;
}

export class CandidateUnavailableError extends Error {
  constructor(message = "Download candidate is missing or expired") {
    super(message);
    this.name = "CandidateUnavailableError";
  }
}

export class InvalidAcquisitionSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAcquisitionSourceError";
  }
}

export function createAcquisitionService(
  dependencies: AcquisitionDependencies,
  options: AcquisitionServiceOptions = {},
): AcquisitionService {
  const now = options.now ?? Date.now;
  const createId = options.id ?? (() => crypto.randomUUID());
  const downloadRoot = validateDownloadRoot(
    options.downloadRoot ?? DEFAULT_DOWNLOAD_ROOT,
  );
  const maxMetainfoBytes =
    options.maxMetainfoBytes ?? DEFAULT_MAX_METAINFO_BYTES;
  validatePositiveInteger(maxMetainfoBytes, "maxMetainfoBytes");
  if (options.defaultPeerLimit !== undefined) {
    validatePositiveInteger(options.defaultPeerLimit, "defaultPeerLimit");
  }

  async function searchCandidates(
    input: CandidateSearchInput,
  ): Promise<CandidateSearchResult> {
    validateTarget(input.target);
    const timestamp = now();
    const expiresAt = timestamp + CANDIDATE_TTL_MS;
    const query = input.query?.trim() || queryForTarget(input.target);
    const page = await dependencies.indexer.search({
      query,
      type: input.target.kind === "movie" ? "movie" : "tvsearch",
      categories: input.categories,
      tmdbId: input.tmdbId,
      imdbId: input.imdbId,
      tvdbId: input.tvdbId,
      season: input.target.season,
      episode: input.target.episode,
      limit: input.limit,
      signal: input.signal,
    });
    const deduplicated = deduplicateReleases(page.results);
    const ranked = rankReleases(deduplicated, input.target, {
      ...input.profile,
      now: timestamp,
    });
    const records: NewStoredCandidate[] = [];
    const excluded: CandidateSearchResult["excluded"][number][] = [];

    for (const result of ranked) {
      const source = sourceFromRelease(result.candidate);
      if (!result.eligible || !source) {
        excluded.push({
          title: result.candidate.title,
          indexer: result.candidate.indexer,
          exclusions: source
            ? result.exclusions
            : [...result.exclusions, "release has no usable download source"],
        });
        continue;
      }
      const infoHash =
        normalizeInfoHash(result.candidate.infoHash) ?? sourceInfoHash(source);
      const sourceCiphertext = await dependencies.candidateCipher.seal({
        source,
        target: input.target,
        infoHash,
      });
      records.push({
        target: input.target,
        tmdbId: input.tmdbId ?? null,
        mediaId: input.mediaId ?? null,
        title: result.candidate.title,
        indexer: result.candidate.indexer,
        sizeBytes: result.candidate.sizeBytes,
        seeders: result.candidate.seeders,
        peers: result.candidate.peers,
        score: result.score,
        reasons: result.reasons,
        facts: result.facts,
        publishedAt: result.candidate.publishedAt,
        sourceCiphertext,
        createdAt: timestamp,
        expiresAt,
      });
    }

    await dependencies.candidateRepository.deleteExpired(timestamp);
    const stored = await dependencies.candidateRepository.saveMany(records);
    return {
      candidates: stored.map(protectedCandidate),
      excluded,
      rawTotal: page.results.length,
      deduplicatedTotal: deduplicated.length,
      expiresAt,
      query,
    };
  }

  async function queueDownload(input: {
    candidateId: string | null;
    target: ReleaseTarget;
    title: string;
    source: CandidateSource;
    sourceCiphertext?: string;
    expectedInfoHash: string | null;
    paused?: boolean;
    peerLimit?: number;
  }): Promise<DownloadView> {
    validateTarget(input.target);
    const timestamp = now();
    const id = requireUuid(createId());
    const peerLimit = input.peerLimit ?? options.defaultPeerLimit ?? null;
    if (peerLimit !== null) validatePositiveInteger(peerLimit, "peerLimit");
    const sourceCiphertext =
      input.sourceCiphertext ??
      (await dependencies.candidateCipher.seal({
        source: input.source,
        target: input.target,
        infoHash: input.expectedInfoHash,
      }));
    const record: DownloadRecord = {
      id,
      candidateId: input.candidateId,
      target: input.target,
      title: input.title,
      state: "queued",
      sourceCiphertext,
      expectedInfoHash: input.expectedInfoHash,
      engineInfoHash: null,
      engineName: null,
      engineLabel: `bobarr:${id}`,
      downloadDirectory: posix.join(downloadRoot, id),
      progress: 0,
      error: null,
      pausedRequested: input.paused ?? false,
      peerLimit,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEngineSeenAt: null,
    };

    // Persistence deliberately completes before the durable job is enqueued.
    // Reconciliation can re-enqueue the record if the process exits here.
    await dependencies.downloadRepository.insert(record);
    await enqueueAddJob(record.id);
    return downloadView(record);
  }

  async function enqueueAddJob(downloadId: string): Promise<void> {
    await dependencies.jobQueue.enqueue({
      type: ADD_TORRENT_JOB,
      payload: { downloadId },
      dedupeKey: downloadId,
      maxAttempts: 5,
    });
  }

  async function enqueueOrganizeJob(downloadId: string): Promise<void> {
    await dependencies.jobQueue.enqueue({
      type: ORGANIZE_DOWNLOAD_JOB,
      payload: { downloadId },
      dedupeKey: downloadId,
      maxAttempts: 5,
    });
  }

  async function startFromCandidate(
    candidateId: string,
    addOptions: AddOptions = {},
  ): Promise<DownloadView> {
    validateOpaqueCandidateId(candidateId);
    const candidate =
      await dependencies.candidateRepository.findById(candidateId);
    if (!candidate || candidate.expiresAt <= now()) {
      throw new CandidateUnavailableError();
    }
    const protectedPayload = await dependencies.candidateCipher.open(
      candidate.sourceCiphertext,
    );
    validateTarget(protectedPayload.target);
    validateSource(protectedPayload.source, maxMetainfoBytes);
    return queueDownload({
      candidateId,
      target: protectedPayload.target,
      title: candidate.title,
      source: protectedPayload.source,
      sourceCiphertext: candidate.sourceCiphertext,
      expectedInfoHash:
        protectedPayload.infoHash ?? sourceInfoHash(protectedPayload.source),
      paused: addOptions.paused,
      peerLimit: addOptions.peerLimit,
    });
  }

  async function startFromMagnet(
    input: ManualDownloadInput & { magnetUri: string },
  ): Promise<DownloadView> {
    const expectedInfoHash = validateMagnetUri(input.magnetUri);
    return queueDownload({
      candidateId: null,
      target: input.target,
      title: input.title?.trim() || input.target.title,
      source: { kind: "magnet", magnetUri: input.magnetUri },
      expectedInfoHash,
      paused: input.paused,
      peerLimit: input.peerLimit,
    });
  }

  async function startFromMetainfo(
    input: ManualDownloadInput & { metainfo: Uint8Array },
  ): Promise<DownloadView> {
    validateMetainfo(input.metainfo, maxMetainfoBytes);
    return queueDownload({
      candidateId: null,
      target: input.target,
      title: input.title?.trim() || input.target.title,
      source: {
        kind: "metainfo",
        metainfoBase64: Buffer.from(input.metainfo).toString("base64"),
      },
      expectedInfoHash: null,
      paused: input.paused,
      peerLimit: input.peerLimit,
    });
  }

  async function retryDownload(downloadId: string): Promise<DownloadView> {
    requireUuid(downloadId);
    const timestamp = now();
    const existing = await dependencies.downloadRepository.findById(downloadId);
    if (
      existing?.state === "failed" &&
      existing.engineInfoHash !== null &&
      existing.error?.startsWith(ORGANIZATION_ERROR_PREFIX)
    ) {
      const record = await dependencies.downloadRepository.transition(
        downloadId,
        ["failed"],
        { state: "completed", error: null, updatedAt: timestamp },
      );
      if (!record) throw new Error("Download is not retryable");
      await enqueueOrganizeJob(downloadId);
      return downloadView(record);
    }
    const record = await dependencies.downloadRepository.transition(
      downloadId,
      ["failed", "missing"],
      { state: "queued", error: null, updatedAt: timestamp },
    );
    if (!record) throw new Error("Download is not retryable");
    await enqueueAddJob(downloadId);
    return downloadView(record);
  }

  async function runAddJob(
    downloadId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    requireUuid(downloadId);
    signal?.throwIfAborted();
    const timestamp = now();
    const record = await dependencies.downloadRepository.transition(
      downloadId,
      ["queued", "failed", "missing", "submitting"],
      { state: "submitting", error: null, updatedAt: timestamp },
    );
    if (!record) {
      const existing =
        await dependencies.downloadRepository.findById(downloadId);
      if (
        existing &&
        [
          "downloading",
          "paused",
          "completed",
          "organizing",
          "organized",
        ].includes(existing.state)
      ) {
        return;
      }
      throw new Error("Download is not in a submittable state");
    }

    try {
      const protectedPayload = await dependencies.candidateCipher.open(
        record.sourceCiphertext,
      );
      const torrentInput = await resolveTorrentInput(
        protectedPayload.source,
        dependencies,
        maxMetainfoBytes,
        signal,
      );
      signal?.throwIfAborted();
      const added = await dependencies.torrentEngine.add(
        torrentInput,
        {
          downloadDirectory: record.downloadDirectory,
          labels: [record.engineLabel],
          paused: record.pausedRequested,
          peerLimit: record.peerLimit ?? undefined,
        },
        signal,
      );
      if (added.duplicate) {
        const existingTorrent = await dependencies.torrentEngine.get(
          added.hash,
          signal,
        );
        const ownedByCurrentDownload =
          existingTorrent !== null &&
          isOwnedTorrent(record, existingTorrent, downloadRoot, added.hash);
        if (!ownedByCurrentDownload) {
          throw new Error(
            "Torrent already exists in Transmission and is not owned by this download",
          );
        }
      }
      await dependencies.downloadRepository.transition(
        record.id,
        ["submitting"],
        {
          state: record.pausedRequested ? "paused" : "downloading",
          engineInfoHash: added.hash,
          engineName: added.name,
          progress: 0,
          error: null,
          updatedAt: now(),
          lastEngineSeenAt: now(),
        },
      );
    } catch (error) {
      await dependencies.downloadRepository.transition(
        record.id,
        ["submitting"],
        {
          state: "failed",
          error: errorMessage(error),
          updatedAt: now(),
        },
      );
      throw error;
    }
  }

  async function runOrganizeJob(
    downloadId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    requireUuid(downloadId);
    if (!dependencies.libraryOrganizer) {
      throw new Error("Library organization is not configured");
    }
    const before = await dependencies.downloadRepository.findById(downloadId);
    const retryingOrganization =
      before?.state === "failed" &&
      before.error?.startsWith(ORGANIZATION_ERROR_PREFIX) === true;
    const record = await dependencies.downloadRepository.transition(
      downloadId,
      retryingOrganization
        ? ["completed", "organizing", "failed"]
        : ["completed", "organizing"],
      { state: "organizing", error: null, updatedAt: now() },
    );
    if (!record) {
      const existing =
        await dependencies.downloadRepository.findById(downloadId);
      if (existing?.state === "organized") return;
      throw new Error("Download is not ready to organize");
    }
    try {
      if (!record.engineInfoHash)
        throw new Error("Download has no torrent hash");
      const torrent = await dependencies.torrentEngine.get(
        record.engineInfoHash,
        signal,
      );
      if (!torrent) {
        throw new Error("Torrent is not complete");
      }
      if (!isOwnedTorrent(record, torrent, downloadRoot)) {
        throw new Error("Transmission torrent ownership could not be verified");
      }
      if (!torrent.finished && torrent.progress < 1) {
        throw new Error("Torrent is not complete");
      }
      await dependencies.libraryOrganizer.organize(
        {
          downloadId: record.id,
          downloadDirectory: record.downloadDirectory,
          target: record.target,
          torrentName: torrent.name,
          files: torrent.files,
        },
        signal,
      );
      await dependencies.downloadRepository.transition(
        record.id,
        ["organizing"],
        { state: "organized", progress: 1, error: null, updatedAt: now() },
      );
    } catch (error) {
      await dependencies.downloadRepository.transition(
        record.id,
        ["organizing"],
        {
          state: "failed",
          error: `${ORGANIZATION_ERROR_PREFIX}${errorMessage(error)}`,
          updatedAt: now(),
        },
      );
      throw error;
    }
  }

  async function reconcile(
    signal?: AbortSignal,
  ): Promise<ReconciliationResult> {
    const records =
      await dependencies.downloadRepository.listForReconciliation();
    const torrents = await dependencies.torrentEngine.list(signal);
    const byLabel = new Map<string, TorrentSnapshot[]>();
    for (const torrent of torrents) {
      for (const label of torrent.labels) {
        const labeled = byLabel.get(label) ?? [];
        labeled.push(torrent);
        byLabel.set(label, labeled);
      }
    }

    const matchedTorrents = new Set<TorrentSnapshot>();
    const missing: string[] = [];
    const requeued: string[] = [];
    let matched = 0;
    for (const record of records) {
      if (record.state === "removed") continue;
      const expectedLabel = `bobarr:${record.id}`;
      const torrent = byLabel
        .get(expectedLabel)
        ?.find((candidate) => isOwnedTorrent(record, candidate, downloadRoot));
      if (torrent) {
        matched += 1;
        matchedTorrents.add(torrent);
        if (
          record.state === "failed" &&
          record.error?.startsWith(ORGANIZATION_ERROR_PREFIX)
        ) {
          continue;
        }
        const state = reconciledState(record.state, torrent);
        const completedProgressChanged =
          state === "completed" && record.progress !== 1;
        const changed =
          state !== record.state ||
          completedProgressChanged ||
          record.engineInfoHash !== torrent.hash ||
          record.engineName !== torrent.name ||
          record.error !== torrent.error;
        if (!changed) continue;
        const updated = await dependencies.downloadRepository.transition(
          record.id,
          [record.state],
          {
            state,
            ...(state === "completed" ? { progress: 1 } : {}),
            engineInfoHash: torrent.hash,
            engineName: torrent.name,
            error: torrent.error,
            updatedAt: now(),
            lastEngineSeenAt: now(),
          },
        );
        if (
          updated?.state === "completed" &&
          dependencies.libraryOrganizer !== undefined
        ) {
          await enqueueOrganizeJob(record.id);
        }
        continue;
      }

      if (record.state === "queued") {
        await enqueueAddJob(record.id);
        requeued.push(record.id);
      } else if (record.state === "submitting") {
        const reset = await dependencies.downloadRepository.transition(
          record.id,
          ["submitting"],
          { state: "queued", error: null, updatedAt: now() },
        );
        if (reset) {
          await enqueueAddJob(record.id);
          requeued.push(record.id);
        }
      } else if (record.state === "downloading" || record.state === "paused") {
        const updated = await dependencies.downloadRepository.transition(
          record.id,
          [record.state],
          {
            state: "missing",
            error: "Torrent is missing from Transmission",
            updatedAt: now(),
          },
        );
        if (updated) missing.push(record.id);
      }
    }

    const orphanedTorrents = torrents.flatMap((torrent) => {
      if (matchedTorrents.has(torrent)) return [];
      const label = torrent.labels.find(isBobarrLabel);
      return label ? [{ hash: torrent.hash, label }] : [];
    });
    return { matched, missing, requeued, orphanedTorrents };
  }

  return {
    searchCandidates,
    startFromCandidate,
    startFromMagnet,
    startFromMetainfo,
    retryDownload,
    runAddJob,
    runOrganizeJob,
    reconcile,
  };
}

export function createAcquisitionJobHandlers(
  service: AcquisitionService,
): Readonly<Record<string, JobHandler>> {
  return {
    [ADD_TORRENT_JOB]: async (job, context) => {
      await service.runAddJob(jobDownloadId(job), context.signal);
    },
    [ORGANIZE_DOWNLOAD_JOB]: async (job, context) => {
      await service.runOrganizeJob(jobDownloadId(job), context.signal);
    },
  };
}

function jobDownloadId(job: DurableJob): string {
  if (
    typeof job.payload !== "object" ||
    job.payload === null ||
    !("downloadId" in job.payload) ||
    typeof job.payload.downloadId !== "string"
  ) {
    throw new TypeError(`Job ${job.id} has no downloadId`);
  }
  return requireUuid(job.payload.downloadId);
}

function protectedCandidate(record: StoredCandidate): ProtectedCandidate {
  return {
    id: record.id,
    title: record.title,
    indexer: record.indexer,
    sizeBytes: record.sizeBytes,
    seeders: record.seeders,
    peers: record.peers,
    score: record.score,
    reasons: record.reasons,
    facts: record.facts,
    expiresAt: record.expiresAt,
  };
}

function downloadView(record: DownloadRecord): DownloadView {
  const { sourceCiphertext: _protectedSource, ...view } = record;
  return view;
}

function deduplicateReleases(
  releases: readonly IndexerRelease[],
): readonly IndexerRelease[] {
  const deduplicated = new Map<string, IndexerRelease>();
  for (const release of releases) {
    const key = dedupeKey(release);
    const current = deduplicated.get(key);
    if (!current || compareDuplicate(release, current) < 0) {
      deduplicated.set(key, release);
    }
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function dedupeKey(release: IndexerRelease): string {
  const infoHash =
    normalizeInfoHash(release.infoHash) ??
    (release.magnetUri ? magnetInfoHash(release.magnetUri) : null);
  return infoHash
    ? `hash:${infoHash.toLowerCase()}`
    : `release:${normalizeReleaseTitle(release.title)}:${release.sizeBytes}`;
}

function compareDuplicate(left: IndexerRelease, right: IndexerRelease): number {
  if (left.seeders !== right.seeders) return right.seeders - left.seeders;
  if (left.peers !== right.peers) return right.peers - left.peers;
  const leftTime = Date.parse(left.publishedAt ?? "") || 0;
  const rightTime = Date.parse(right.publishedAt ?? "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.id.localeCompare(right.id);
}

function sourceFromRelease(release: IndexerRelease): CandidateSource | null {
  if (release.magnetUri) {
    try {
      validateMagnetUri(release.magnetUri);
      return { kind: "magnet", magnetUri: release.magnetUri };
    } catch {
      // A valid Jackett proxy URL can still be used below.
    }
  }
  if (release.downloadUrl) {
    try {
      const url = new URL(release.downloadUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return { kind: "jackett", downloadUrl: release.downloadUrl };
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveTorrentInput(
  source: CandidateSource,
  dependencies: AcquisitionDependencies,
  maxMetainfoBytes: number,
  signal?: AbortSignal,
): Promise<TorrentInput> {
  validateSource(source, maxMetainfoBytes);
  if (source.kind === "magnet") return { magnetUri: source.magnetUri };
  if (source.kind === "metainfo") {
    const metainfo = Uint8Array.from(
      Buffer.from(source.metainfoBase64, "base64"),
    );
    validateMetainfo(metainfo, maxMetainfoBytes);
    return { metainfo };
  }
  const metainfo = await dependencies.indexer.fetchMetainfo(
    source.downloadUrl,
    signal,
  );
  validateMetainfo(metainfo, maxMetainfoBytes);
  return { metainfo };
}

function validateSource(
  source: CandidateSource,
  maxMetainfoBytes: number,
): void {
  if (source.kind === "magnet") {
    validateMagnetUri(source.magnetUri);
  } else if (source.kind === "jackett") {
    const url = new URL(source.downloadUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new InvalidAcquisitionSourceError("Invalid Jackett download URL");
    }
  } else {
    validateMetainfo(
      Uint8Array.from(Buffer.from(source.metainfoBase64, "base64")),
      maxMetainfoBytes,
    );
  }
}

function validateMetainfo(value: Uint8Array, maxBytes: number): void {
  if (value.byteLength === 0 || value[0] !== 0x64) {
    throw new InvalidAcquisitionSourceError(
      "Torrent metainfo must be a bencoded dictionary",
    );
  }
  if (value.byteLength > maxBytes) {
    throw new InvalidAcquisitionSourceError(
      `Torrent metainfo exceeds the ${maxBytes} byte limit`,
    );
  }
}

function validateMagnetUri(value: string): string {
  if (value.length === 0 || value.length > 16_384) {
    throw new InvalidAcquisitionSourceError("Magnet URI has an invalid length");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidAcquisitionSourceError("Magnet URI is invalid");
  }
  if (url.protocol !== "magnet:") {
    throw new InvalidAcquisitionSourceError("Torrent source must use magnet:");
  }
  const infoHash = url.searchParams
    .getAll("xt")
    .map((topic) => /^(?:urn:btih:|urn:btmh:)(.+)$/i.exec(topic)?.[1])
    .find((hash): hash is string => normalizeInfoHash(hash) !== null);
  if (!infoHash) {
    throw new InvalidAcquisitionSourceError(
      "Magnet URI has no supported torrent infohash",
    );
  }
  return infoHash;
}

function magnetInfoHash(value: string): string | null {
  try {
    return validateMagnetUri(value);
  } catch {
    return null;
  }
}

function normalizeInfoHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^(?:[a-f\d]{40}|[a-z2-7]{32}|1220[a-f\d]{64})$/i.test(value)
    ? value
    : null;
}

function sourceInfoHash(source: CandidateSource): string | null {
  return source.kind === "magnet" ? magnetInfoHash(source.magnetUri) : null;
}

function queryForTarget(target: ReleaseTarget): string {
  if (target.kind === "movie") {
    return `${target.title}${target.year ? ` ${target.year}` : ""}`;
  }
  const season = String(target.season).padStart(2, "0");
  return target.kind === "episode"
    ? `${target.title} S${season}E${String(target.episode).padStart(2, "0")}`
    : `${target.title} S${season}`;
}

function validateTarget(target: ReleaseTarget): void {
  if (!target.title.trim())
    throw new TypeError("Acquisition title is required");
  if (target.kind !== "movie") {
    if (
      target.season === undefined ||
      !Number.isSafeInteger(target.season) ||
      target.season < 0
    ) {
      throw new TypeError("TV acquisition requires a valid season");
    }
  }
  if (
    target.kind === "episode" &&
    (target.episode === undefined ||
      !Number.isSafeInteger(target.episode) ||
      target.episode < 0)
  ) {
    throw new TypeError("Episode acquisition requires a valid episode");
  }
}

function validateDownloadRoot(value: string): string {
  if (!value.startsWith("/") || value.includes("\0")) {
    throw new TypeError("Transmission download root must be an absolute path");
  }
  return posix.normalize(value);
}

function requireUuid(value: string): string {
  if (
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      value,
    )
  ) {
    throw new TypeError("Expected an opaque UUID identifier");
  }
  return value;
}

function validateOpaqueCandidateId(value: string): string {
  if (!/^rel_[a-z\d_-]{32,}$/i.test(value)) {
    throw new TypeError("Expected an opaque release candidate identifier");
  }
  return value;
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

export function isOwnedTorrent(
  record: DownloadRecord,
  torrent: TorrentSnapshot,
  downloadRoot: string,
  requiredInfoHash?: string,
): boolean {
  const expectedLabel = `bobarr:${record.id}`;
  const expectedDirectory = posix.join(downloadRoot, record.id);
  if (
    record.engineLabel !== expectedLabel ||
    posix.normalize(record.downloadDirectory) !== expectedDirectory ||
    !torrent.labels.includes(expectedLabel) ||
    posix.normalize(torrent.downloadDirectory) !== expectedDirectory
  ) {
    return false;
  }

  const actualInfoHash = canonicalInfoHash(torrent.hash);
  if (actualInfoHash === null) return false;
  const knownInfoHashes: string[] = [];
  for (const hash of [
    record.engineInfoHash,
    record.expectedInfoHash,
    requiredInfoHash,
  ]) {
    if (hash === null || hash === undefined) continue;
    const canonical = canonicalInfoHash(hash);
    if (canonical === null) return false;
    knownInfoHashes.push(canonical);
  }
  return knownInfoHashes.every((known) => known === actualInfoHash);
}

function canonicalInfoHash(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^[a-f\d]{40}$/i.test(value)) return value.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(value)) return decodeBase32Hash(value);
  if (/^1220[a-f\d]{64}$/i.test(value)) return value.slice(4).toLowerCase();
  if (/^[a-f\d]{64}$/i.test(value)) return value.toLowerCase();
  return null;
}

function decodeBase32Hash(value: string): string | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;
  for (const character of value.toUpperCase()) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    buffer = (buffer << 5) | digit;
    bitCount += 5;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }
  return bytes.length === 20 ? Buffer.from(bytes).toString("hex") : null;
}

function reconciledState(
  current: DownloadState,
  torrent: TorrentSnapshot,
): DownloadState {
  if (current === "organized" || current === "organizing") return current;
  if (torrent.error) return "failed";
  if (torrent.finished || torrent.progress >= 1) return "completed";
  return torrent.status === "stopped" ? "paused" : "downloading";
}

function isBobarrLabel(value: string): boolean {
  return /^bobarr:[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
    value,
  );
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}
