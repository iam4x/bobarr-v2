import type { JackettClient } from "../integrations/jackett";
import type { TmdbClient } from "../integrations/tmdb";
import type { TorrentEngine as TransmissionClient } from "../integrations/transmission";
import type {
  IndexerGateway,
  LibraryOrganizer,
  MetadataProvider,
  CandidateRepository,
  NewStoredCandidate,
  OrganizedFile,
  TorrentEngine,
  TorrentFile,
} from "./ports";

import { extname } from "node:path";

import { inspectRelease } from "../domain/releases";
import {
  organizeFile,
  type CollisionPolicy,
  type OrganizationMode,
} from "../library/organizer";
import {
  episodeLibraryPath,
  isPathContained,
  movieLibraryPath,
} from "../library/paths";

interface DatabaseReleaseCandidate {
  id: string;
  title: string;
  indexer: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  score: number;
  reasons: readonly string[];
  expiresAt: string;
  createdAt: string;
}

interface DatabaseReleaseCandidateStore {
  create(input: {
    mediaId: string | null;
    tmdbId: number | null;
    mediaKind: "movie" | "season" | "episode";
    title: string;
    indexer: string;
    sizeBytes: number;
    seeders: number;
    leechers: number;
    publishedAt: string | null;
    quality: string | null;
    score: number;
    eligible: boolean;
    reasons: string[];
    protectedSourcePayload: string;
    ttlSeconds?: number;
  }): DatabaseReleaseCandidate;
  resolve(id: string):
    | {
        candidate: DatabaseReleaseCandidate;
        protectedSourcePayload: string;
      }
    | undefined;
  purgeExpired(): number;
}

export function metadataProviderFromTmdb(client: TmdbClient): MetadataProvider {
  return client;
}

export function indexerGatewayFromJackett(
  client: JackettClient,
): IndexerGateway {
  return {
    search: (request) => client.search(request),
    fetchMetainfo: (url, signal) => client.downloadTorrent(url, signal),
  };
}

export function torrentEngineFromTransmission(
  client: TransmissionClient,
): TorrentEngine {
  return {
    add: (source, options, signal) => client.add(source, options, signal),
    get: (hash, signal) => client.get(hash, signal),
    list: (signal) => client.list(signal),
    selectFiles: (hash, selection, signal) =>
      client.selectFiles(hash, selection, signal),
    start: (hash, signal) => client.start(hash, signal),
    pause: (hash, signal) => client.pause(hash, signal),
    remove: (hash, deleteData, signal) =>
      client.remove(hash, deleteData, signal),
  };
}

export function candidateRepositoryFromDatabase(
  repository: DatabaseReleaseCandidateStore,
): CandidateRepository {
  return {
    async saveMany(candidates) {
      return candidates.map((candidate) => {
        const persisted = repository.create(databaseCandidate(candidate));
        return storedCandidate(persisted, candidate.sourceCiphertext);
      });
    },
    async findById(id) {
      const resolved = repository.resolve(id);
      return resolved
        ? storedCandidate(resolved.candidate, resolved.protectedSourcePayload)
        : null;
    },
    async deleteExpired() {
      return repository.purgeExpired();
    },
  };
}

function databaseCandidate(candidate: NewStoredCandidate) {
  return {
    mediaId: candidate.mediaId,
    tmdbId: candidate.tmdbId,
    mediaKind: candidate.target.kind,
    title: candidate.title,
    indexer: candidate.indexer ?? "unknown",
    sizeBytes: candidate.sizeBytes,
    seeders: candidate.seeders,
    leechers: candidate.peers,
    publishedAt: candidate.publishedAt,
    quality:
      candidate.facts.quality === "unknown" ? null : candidate.facts.quality,
    score: candidate.score,
    eligible: true,
    reasons: [...candidate.reasons],
    protectedSourcePayload: candidate.sourceCiphertext,
    ttlSeconds: Math.max(
      1,
      Math.round((candidate.expiresAt - candidate.createdAt) / 1_000),
    ),
  };
}

function storedCandidate(
  candidate: DatabaseReleaseCandidate,
  sourceCiphertext: string,
) {
  return {
    id: candidate.id,
    title: candidate.title,
    indexer: candidate.indexer,
    sizeBytes: candidate.sizeBytes,
    seeders: candidate.seeders,
    peers: candidate.leechers,
    score: candidate.score,
    reasons: candidate.reasons,
    facts: inspectRelease(candidate.title),
    sourceCiphertext,
    createdAt: Date.parse(candidate.createdAt),
    expiresAt: Date.parse(candidate.expiresAt),
  };
}

export interface FilesystemLibraryOrganizerOptions {
  downloadsRoot: string;
  movieLibraryRoot: string;
  seriesLibraryRoot: string;
  mode?: OrganizationMode;
  collision?: CollisionPolicy;
  fallbackToCopy?: boolean;
}

export function createFilesystemLibraryOrganizer(
  options: FilesystemLibraryOrganizerOptions,
): LibraryOrganizer {
  const mode = options.mode ?? "hardlink";
  return {
    async organize(request, signal) {
      signal?.throwIfAborted();
      if (!isPathContained(options.downloadsRoot, request.downloadDirectory)) {
        throw new Error(
          "Torrent download directory escapes the configured root",
        );
      }
      const selected = selectMediaFiles(request.files, request.target);
      if (selected.length === 0) {
        throw new Error("Completed torrent contains no matching media files");
      }
      const libraryRoot =
        request.target.kind === "movie"
          ? options.movieLibraryRoot
          : options.seriesLibraryRoot;
      const organized: OrganizedFile[] = [];
      for (const file of selected) {
        signal?.throwIfAborted();
        const extension = extname(file.name);
        const relativeDestination =
          request.target.kind === "movie"
            ? movieLibraryPath({
                title: request.target.title,
                year: request.target.year,
                extension,
              })
            : episodeDestination(request.target, file, extension);
        const result = await organizeFile({
          sourceRoot: request.downloadDirectory,
          libraryRoot,
          sourcePath: file.name,
          relativeDestination,
          mode,
          collision: options.collision,
          fallbackToCopy: options.fallbackToCopy,
        });
        organized.push({
          source: result.source,
          destination: result.destination,
          created: result.created,
        });
      }
      return organized;
    },
  };
}

function selectMediaFiles(
  files: readonly TorrentFile[],
  target: {
    kind: "movie" | "season" | "episode";
    season?: number;
    episode?: number;
  },
): readonly TorrentFile[] {
  const media = files
    .filter(
      (file) =>
        file.wanted &&
        file.length > 0 &&
        file.bytesCompleted >= file.length &&
        /\.(?:mkv|mp4|m4v|avi|mov|webm|ts)$/i.test(file.name) &&
        !/(?:^|[/._ -])sample(?:[/._ -]|$)/i.test(file.name),
    )
    .sort(
      (left, right) =>
        right.length - left.length || left.name.localeCompare(right.name),
    );
  if (target.kind === "movie") return media.slice(0, 1);
  const matching = media.filter((file) => {
    const identity = episodeIdentity(file.name);
    if (identity.season !== target.season) return false;
    return (
      target.kind === "season" ||
      (target.episode !== undefined &&
        identity.episodes.includes(target.episode))
    );
  });
  if (target.kind === "episode") {
    return matching.slice(0, 1);
  }
  return matching;
}

function episodeDestination(
  target: {
    title: string;
    year?: number;
    season?: number;
    episode?: number;
  },
  file: TorrentFile,
  extension: string,
): string {
  const identity = episodeIdentity(file.name);
  const season = identity.season ?? target.season;
  const episode = identity.episodes[0] ?? target.episode;
  if (season === undefined || episode === undefined) {
    throw new Error(`Could not identify episode from ${file.name}`);
  }
  return episodeLibraryPath({
    showTitle: target.title,
    showYear: target.year,
    season,
    episode,
    endEpisode: identity.episodes.at(-1),
    extension,
  });
}

function episodeIdentity(name: string): {
  season: number | null;
  episodes: number[];
} {
  const compact = /(?:^|\D)s(\d{1,3})(?=[ ._-]*e\d)/i.exec(name);
  if (compact?.[1] && compact.index !== undefined) {
    const tail = name.slice(compact.index + compact[0].length);
    return {
      season: Number(compact[1]),
      episodes: uniqueNumbers(
        [...tail.matchAll(/e(\d{1,4})(?!\d)/gi)].map((match) =>
          Number(match[1]),
        ),
      ),
    };
  }
  const cross = /(?:^|\D)(\d{1,3})(?=x\d{1,4})/i.exec(name);
  if (cross?.[1] && cross.index !== undefined) {
    const tail = name.slice(cross.index + cross[0].length);
    return {
      season: Number(cross[1]),
      episodes: uniqueNumbers(
        [...tail.matchAll(/x(\d{1,4})(?!\d)/gi)].map((match) =>
          Number(match[1]),
        ),
      ),
    };
  }
  return {
    season: null,
    episodes: [],
  };
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isSafeInteger))].sort(
    (left, right) => left - right,
  );
}
