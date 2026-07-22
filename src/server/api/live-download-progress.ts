import type { BackendDatabase, Repositories } from "../db";
import type { IntegrationResolver } from "./integration-resolver";

import {
  downloadRepositoryFromDatabase,
  isOwnedTorrent,
  type TorrentSnapshot,
} from "../application";

interface LiveDownloadDependencies {
  database: BackendDatabase;
  repositories: Pick<Repositories, "settings">;
  integrations?: IntegrationResolver;
}

interface DownloadProgressProjection {
  id: string;
  externalId: string | null;
  state: string;
  progress: number;
}

/**
 * Overlays live Transmission state on a batch of durable downloads. A single
 * Transmission list request serves the whole batch and failures gracefully
 * fall back to the last durable snapshot.
 */
export async function withLiveDownloadProgress<
  T extends DownloadProgressProjection,
>(
  downloads: readonly T[],
  dependencies: LiveDownloadDependencies,
  signal?: AbortSignal,
): Promise<T[]> {
  if (downloads.length === 0 || dependencies.integrations === undefined) {
    return [...downloads];
  }
  try {
    const [torrents, durableDownloads] = await Promise.all([
      (await dependencies.integrations.transmission()).list(signal),
      downloadRepositoryFromDatabase(
        dependencies.database,
      ).listForReconciliation(),
    ]);
    const byHash = new Map(
      torrents.map((torrent) => [torrent.hash.toLowerCase(), torrent]),
    );
    const durableById = new Map(
      durableDownloads.map((download) => [download.id, download]),
    );
    const downloadRoot =
      dependencies.repositories.settings.ensureDefaults().settings.storage
        .downloadsPath;
    return downloads.map((download) => {
      const torrent = download.externalId
        ? byHash.get(download.externalId.toLowerCase())
        : undefined;
      const durable = durableById.get(download.id);
      return torrent &&
        durable &&
        isOwnedTorrent(
          durable,
          torrent,
          downloadRoot,
          download.externalId ?? undefined,
        )
        ? ({ ...download, ...liveDownloadFields(download.state, torrent) } as T)
        : download;
    });
  } catch {
    return [...downloads];
  }
}

function liveDownloadFields(durableState: string, torrent: TorrentSnapshot) {
  let state = durableState;
  if (durableState !== "completed" && durableState !== "failed") {
    if (torrent.error) state = "failed";
    else if (torrent.finished || torrent.progress >= 1) state = "seeding";
    else if (torrent.status === "stopped") state = "paused";
    else if (torrent.status.includes("verify")) state = "checking";
    else state = "downloading";
  }
  const totalBytes = Math.max(torrent.sizeWhenDone, torrent.totalSize, 0);
  return {
    state,
    progress: Math.max(0, Math.min(100, torrent.progress * 100)),
    downloadedBytes: Math.max(0, totalBytes - torrent.leftUntilDone),
    totalBytes,
    downloadRate: Math.max(0, torrent.downloadRate),
    uploadRate: Math.max(0, torrent.uploadRate),
    etaSeconds: torrent.etaSeconds,
    error: torrent.error,
    files: torrent.files.map((file) => ({ ...file })),
  };
}
