import type { LibraryItem } from "../../contracts";
import type { Repositories } from "../db";

import { basename, extname } from "node:path";

export interface ImportedFile {
  path: string;
  sizeBytes: number;
}

/** Build a minimal movie/season/episode tree from an existing media layout. */
export function importRecordedFiles(options: {
  media: LibraryItem;
  files: readonly ImportedFile[];
  repositories: Repositories;
}): void {
  const { media, files, repositories } = options;
  repositories.media.updateState(media.id, "available");
  for (const file of files) {
    let mediaId = media.id;
    if (media.kind === "series") {
      const identity = parseExistingEpisodeIdentity(file.path);
      if (identity.season !== null) {
        const season = ensureSeason(media, identity.season, repositories);
        mediaId = season.id;
        const episodes = identity.episodes.map((episodeNumber) =>
          ensureEpisode(media, season, episodeNumber, file.path, repositories),
        );
        if (episodes.length === 1) mediaId = episodes[0]!.id;
      }
    }
    repositories.libraryFiles.upsert({
      mediaId,
      downloadId: null,
      path: file.path,
      sizeBytes: file.sizeBytes,
      quality: null,
      videoCodec: null,
      audioCodec: null,
      strategy: "copy",
    });
  }
}

export function parseExistingEpisodeIdentity(path: string): {
  season: number | null;
  episodes: number[];
} {
  const compact = /(?:^|\D)s(\d{1,3})(?=[ ._-]*e\d)/i.exec(path);
  if (compact?.[1] && compact.index !== undefined) {
    const tail = path.slice(compact.index + compact[0].length);
    return {
      season: Number(compact[1]),
      episodes: uniquePositiveIntegers(
        [...tail.matchAll(/e(\d{1,4})(?!\d)/gi)].map((match) =>
          Number(match[1]),
        ),
      ),
    };
  }
  const cross = /(?:^|\D)(\d{1,3})(?=x\d{1,4})/i.exec(path);
  if (cross?.[1] && cross.index !== undefined) {
    const tail = path.slice(cross.index + cross[0].length);
    return {
      season: Number(cross[1]),
      episodes: uniquePositiveIntegers(
        [...tail.matchAll(/x(\d{1,4})(?!\d)/gi)].map((match) =>
          Number(match[1]),
        ),
      ),
    };
  }
  const season = /(?:^|[/\\._ -])season[ ._-]*(\d{1,3})(?:[/\\._ -]|$)/i.exec(
    path,
  );
  return { season: season?.[1] ? Number(season[1]) : null, episodes: [] };
}

function ensureSeason(
  series: LibraryItem,
  seasonNumber: number,
  repositories: Repositories,
): LibraryItem {
  const existing = repositories.media
    .children(series.id)
    .find(
      (item) => item.kind === "season" && item.seasonNumber === seasonNumber,
    );
  if (existing) {
    repositories.media.updateState(existing.id, "available");
    return existing;
  }
  return repositories.media.create({
    kind: "season",
    tmdbId: null,
    parentId: series.id,
    seasonNumber,
    episodeNumber: null,
    title: `${series.title} — Season ${seasonNumber}`,
    year: series.year,
    posterUrl: series.posterUrl,
    status: "available",
    monitorPolicy: "none",
    releaseDate: null,
    metadata: { imported: true, seriesTmdbId: series.tmdbId },
  });
}

function ensureEpisode(
  series: LibraryItem,
  season: LibraryItem,
  episodeNumber: number,
  path: string,
  repositories: Repositories,
): LibraryItem {
  const existing = repositories.media
    .children(season.id)
    .find(
      (item) => item.kind === "episode" && item.episodeNumber === episodeNumber,
    );
  if (existing) {
    repositories.media.updateState(existing.id, "available");
    return existing;
  }
  const filename = basename(path, extname(path));
  return repositories.media.create({
    kind: "episode",
    tmdbId: null,
    parentId: season.id,
    seasonNumber: season.seasonNumber,
    episodeNumber,
    title: filename,
    year: series.year,
    posterUrl: series.posterUrl,
    status: "available",
    monitorPolicy: "none",
    releaseDate: null,
    metadata: { imported: true, seriesId: series.id },
  });
}

function uniquePositiveIntegers(values: readonly number[]): number[] {
  return [...new Set(values)]
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .sort((left, right) => left - right);
}
