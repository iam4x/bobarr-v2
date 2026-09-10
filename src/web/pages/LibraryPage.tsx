import type {
  LibraryDownloadFile,
  MonitorMediaPatch,
} from "../../contracts/api-routes";
import type {
  AcquisitionState,
  CatalogActor,
  CatalogTrailer,
  LibraryItem,
  MonitorPolicy,
} from "../types";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDown,
  CalendarClock,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Compass,
  Download,
  EyeOff,
  Film,
  FolderOpen,
  ListVideo,
  RefreshCw,
  ScanSearch,
  Search,
  Settings2,
  Star,
  Trash2,
  Tv,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  createDefaultLibraryBrowseFilters,
  LIBRARY_QUALITY_OPTIONS,
  LIBRARY_RATING_OPTIONS,
  LIBRARY_SORT_OPTIONS,
  libraryQualityLabel,
  libraryRatingLabel,
  librarySortLabel,
  libraryAvailabilityParam,
  libraryBrowseFromSearchParams,
  libraryBrowseIsDefault,
  libraryNeedsAttentionCount,
  optionalBrowseNumber,
  writeLibraryBrowseSearchParams,
  type LibraryBrowseFilters,
  type LibraryFilter,
} from "./libraryBrowsing";
import {
  LibraryAttentionStrip,
  LibraryEmptyGuidance,
  MediaLibraryShelves,
} from "./MovieLibraryExtras";
import { api } from "../api/client";
import { collectionItems } from "../api/normalize";
import {
  actorDiscoverPath,
  MovieCast,
  WatchTrailerButton,
} from "../components/Catalog";
import { Page } from "../components/Page";
import {
  type ManualReleaseTarget,
  ReleaseSearchPanel,
} from "../components/ReleaseSearchPanel";
import { ScanReviewPanel } from "../components/ScanReviewPanel";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  InlineSpinner,
  ProgressBar,
  SegmentedControl,
  SelectControl,
  SelectField,
  SkeletonGrid,
} from "../components/ui";
import { en, type Messages } from "../i18n/en";
import { useUi } from "../i18n/ui";
import {
  formatBytes,
  formatDate,
  formatEta,
  formatRate,
  imageUrl,
  initials,
  mediaYear,
  toPercent,
} from "../lib/format";

type ManualReleaseAction = "search" | "replace";
const LIBRARY_PAGE_SIZE = 50;

export function libraryPlaceholderData<T>(
  previousData: T | undefined,
  previousKind: unknown,
  nextKind: "movie" | "series",
): T | undefined {
  return previousKind === nextKind ? previousData : undefined;
}

export function LibrarySummary({
  summary,
  filter,
  onFilterChange,
}: {
  summary: {
    total: number;
    downloaded: number;
    active: number;
    missing: number;
    failed: number;
  };
  filter?: LibraryFilter;
  onFilterChange?: (filter: LibraryFilter) => void;
}) {
  const { messages } = useUi();
  const renderValue = (key: LibraryFilter, value: number) => {
    if (!onFilterChange) return value;
    return (
      <button
        type="button"
        className={filter === key ? "is-active" : undefined}
        aria-pressed={filter === key}
        onClick={() => onFilterChange(filter === key ? "all" : key)}
      >
        {value}
      </button>
    );
  };

  return (
    <dl className="library-summary" aria-label={messages.library.summary}>
      <div>
        <dt>{messages.library.downloaded}</dt>
        <dd>{renderValue("available", summary.downloaded)}</dd>
      </div>
      <div>
        <dt>{messages.library.active}</dt>
        <dd>{renderValue("active", summary.active)}</dd>
      </div>
      <div>
        <dt>{messages.library.missing}</dt>
        <dd>{renderValue("missing", summary.missing)}</dd>
      </div>
      <div>
        <dt>{messages.library.total}</dt>
        <dd>
          {onFilterChange ? (
            <button
              type="button"
              className={filter === "all" ? "is-active" : undefined}
              aria-pressed={filter === "all"}
              onClick={() => onFilterChange("all")}
            >
              {summary.total}
            </button>
          ) : (
            summary.total
          )}
        </dd>
      </div>
    </dl>
  );
}

function acquisitionTone(
  state: AcquisitionState,
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (state === "available") return "success";
  if (state === "missing" || state === "failed") return "danger";
  if (["searching", "queued", "downloading", "organizing"].includes(state))
    return "info";
  return "neutral";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function compactVoteCount(votes: number): string {
  if (votes >= 1_000_000) {
    return `${(votes / 1_000_000).toFixed(votes >= 10_000_000 ? 0 : 1)}m`;
  }
  if (votes >= 1_000) {
    return `${(votes / 1_000).toFixed(votes >= 10_000 ? 0 : 1)}k`;
  }
  return String(votes);
}

function downloadStateLabel(state: string, messages: Messages = en): string {
  const labels: Record<string, string> = {
    searching: messages.status.searching,
    queued: messages.status.queued,
    downloading: messages.status.downloading,
    organizing: messages.status.organizing,
    available: messages.status.available,
    missing: messages.status.missing,
    failed: messages.status.failed,
    unmonitored: messages.status.unmonitored,
    paused: messages.status.paused,
    seeding: messages.status.seeding,
    checking: messages.status.checking,
    completed: messages.status.completed,
    pending: messages.status.pending,
    running: messages.status.running,
    retrying: messages.status.retrying,
    cancelled: messages.status.cancelled,
  };
  return labels[state] ?? `${state.slice(0, 1).toUpperCase()}${state.slice(1)}`;
}

export type EpisodeDisplayState =
  | "ready"
  | "searching"
  | "queued"
  | "downloading"
  | "organizing"
  | "missing"
  | "failed"
  | "upcoming"
  | "tba"
  | "unmonitored";

export interface EpisodeDisplayStatus {
  state: EpisodeDisplayState;
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  active: boolean;
  needsAttention: boolean;
}

function parsedReleaseAt(
  item: Pick<LibraryItem, "releaseDate">,
): number | null {
  if (!item.releaseDate) return null;
  const value = Date.parse(item.releaseDate);
  return Number.isFinite(value) ? value : null;
}

function releaseDay(item: Pick<LibraryItem, "releaseDate">): string | null {
  if (parsedReleaseAt(item) === null) return null;
  return item.releaseDate!.slice(0, 10);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function episodeDisplayStatus(
  episode: LibraryItem,
  now = Date.now(),
  messages: Messages = en,
): EpisodeDisplayStatus {
  if (episode.acquisitionState === "available") {
    return {
      state: "ready",
      label: messages.library.ready,
      tone: "success",
      active: false,
      needsAttention: false,
    };
  }
  if (
    ["searching", "queued", "downloading", "organizing"].includes(
      episode.acquisitionState,
    )
  ) {
    return {
      state: episode.acquisitionState as
        | "searching"
        | "queued"
        | "downloading"
        | "organizing",
      label: downloadStateLabel(episode.acquisitionState, messages),
      tone: "info",
      active: true,
      needsAttention: false,
    };
  }
  if ((episode.storage?.fileCount ?? 0) > 0) {
    return {
      state: "ready",
      label: messages.library.ready,
      tone: "success",
      active: false,
      needsAttention: false,
    };
  }
  if (
    episode.monitorPolicy === "none" ||
    episode.acquisitionState === "unmonitored"
  ) {
    return {
      state: "unmonitored",
      label: messages.library.notMonitored,
      tone: "neutral",
      active: false,
      needsAttention: false,
    };
  }

  const airDay = releaseDay(episode);
  const today = utcDay(now);
  if (airDay !== null && airDay >= today) {
    return {
      state: "upcoming",
      label: messages.library.upcoming,
      tone: "neutral",
      active: false,
      needsAttention: false,
    };
  }
  if (airDay === null && episode.acquisitionState === "missing") {
    return {
      state: "tba",
      label: messages.library.airDateTba,
      tone: "neutral",
      active: false,
      needsAttention: false,
    };
  }
  if (episode.acquisitionState === "failed") {
    return {
      state: "failed",
      label: messages.library.needsAttention,
      tone: "danger",
      active: false,
      needsAttention: true,
    };
  }
  return {
    state: "missing",
    label: messages.library.airedFileMissing,
    tone: "danger",
    active: false,
    needsAttention: true,
  };
}

export function summarizeEpisodeStates(
  episodes: readonly LibraryItem[],
  now = Date.now(),
) {
  const summary = {
    ready: 0,
    active: 0,
    missing: 0,
    upcoming: 0,
    unmonitored: 0,
    total: episodes.length,
  };
  for (const episode of episodes) {
    const status = episodeDisplayStatus(episode, now);
    if (status.state === "ready") summary.ready += 1;
    else if (status.active) summary.active += 1;
    else if (status.needsAttention) summary.missing += 1;
    else if (status.state === "unmonitored") summary.unmonitored += 1;
    else summary.upcoming += 1;
  }
  return summary;
}

export function defaultTvSeasonNumber(
  seasons: readonly LibraryItem[],
  now = Date.now(),
): number | undefined {
  const validSeasons = seasons
    .filter(
      (season) =>
        season.kind === "season" && isPositiveSafeInteger(season.seasonNumber),
    )
    .sort(
      (left, right) => (left.seasonNumber ?? 0) - (right.seasonNumber ?? 0),
    );
  const monitored = validSeasons.filter(
    (season) =>
      season.monitorPolicy !== "none" &&
      isPositiveSafeInteger(season.seasonNumber),
  );
  const active = monitored.findLast((season) =>
    ["searching", "queued", "downloading", "organizing"].includes(
      season.acquisitionState,
    ),
  );
  const airedNeedsAttention = monitored.findLast((season) => {
    const airDay = releaseDay(season);
    return (
      airDay !== null &&
      airDay < utcDay(now) &&
      ["missing", "failed"].includes(season.acquisitionState)
    );
  });
  const latestAired = monitored.findLast((season) => {
    const airDay = releaseDay(season);
    return airDay !== null && airDay < utcDay(now);
  });
  return (
    active?.seasonNumber ??
    airedNeedsAttention?.seasonNumber ??
    latestAired?.seasonNumber ??
    monitored.at(-1)?.seasonNumber ??
    validSeasons
      .filter(
        (season) =>
          season.acquisitionState === "available" ||
          (season.storage?.fileCount ?? 0) > 0,
      )
      .at(-1)?.seasonNumber ??
    validSeasons.at(-1)?.seasonNumber ??
    undefined
  );
}

export function monitoringSeasonNumbers(
  seasons: readonly LibraryItem[],
  metadataSeasonCount: number,
): number[] {
  const numbers = new Set<number>();
  if (Number.isSafeInteger(metadataSeasonCount) && metadataSeasonCount > 0) {
    for (let season = 1; season <= metadataSeasonCount; season += 1) {
      numbers.add(season);
    }
  }
  for (const season of seasons) {
    if (isPositiveSafeInteger(season.seasonNumber)) {
      numbers.add(season.seasonNumber);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

export function libraryReleaseTarget(
  item: LibraryItem,
  seasonNumber?: number,
  episodeNumber?: number | null,
): ManualReleaseTarget | null {
  if (!isPositiveSafeInteger(item.tmdbId)) return null;
  if (item.kind === "movie") {
    return { tmdbId: item.tmdbId, kind: "movie" };
  }
  if (item.kind !== "series" || !isPositiveSafeInteger(seasonNumber)) {
    return null;
  }
  if (
    episodeNumber !== undefined &&
    episodeNumber !== null &&
    !isPositiveSafeInteger(episodeNumber)
  ) {
    return null;
  }
  return {
    tmdbId: item.tmdbId,
    kind: "series",
    season: seasonNumber,
    ...(episodeNumber === undefined || episodeNumber === null
      ? {}
      : { episode: episodeNumber }),
  };
}

export function defaultEpisodeReleaseTarget(
  season: LibraryItem | undefined,
  episodes: readonly LibraryItem[],
  now = Date.now(),
): number | null {
  if (!season || season.kind !== "season") return null;
  const sorted = episodes
    .filter(
      (episode) =>
        episode.kind === "episode" &&
        episode.monitorPolicy !== "none" &&
        ["missing", "failed", "queued", "downloading"].includes(
          episode.acquisitionState,
        ) &&
        isPositiveSafeInteger(episode.episodeNumber),
    )
    .sort(
      (left, right) => (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0),
    );
  const incomplete = episodes.some((episode) => {
    if (episode.kind !== "episode") return false;
    if (!episode.releaseDate) return true;
    const releaseAt = Date.parse(episode.releaseDate);
    return !Number.isFinite(releaseAt) || releaseAt > now;
  });
  if (season.metadata?.["acquisitionMode"] !== "episodes" && !incomplete) {
    return null;
  }

  const missing = sorted.filter((episode) =>
    ["missing", "failed"].includes(episode.acquisitionState),
  );
  const released = missing.find((episode) => {
    if (!episode.releaseDate) return true;
    const releaseAt = Date.parse(episode.releaseDate);
    return !Number.isFinite(releaseAt) || releaseAt <= now;
  });
  return (
    released?.episodeNumber ??
    missing[0]?.episodeNumber ??
    sorted[0]?.episodeNumber ??
    null
  );
}

export function canManuallySearchLibraryItem(
  item: LibraryItem | null,
): boolean {
  return (
    item !== null &&
    item.monitorPolicy !== "none" &&
    isPositiveSafeInteger(item.tmdbId)
  );
}

export function libraryItemHasFile(item: LibraryItem | null): boolean {
  if (!item) return false;
  if (item.storage) return item.storage.fileCount > 0;
  return item.acquisitionState === "available";
}

export function libraryManualReleaseAction(
  item: LibraryItem | null,
): ManualReleaseAction | null {
  if (!item || !isPositiveSafeInteger(item.tmdbId)) return null;
  if (libraryItemHasFile(item) || item.activeDownload) {
    return "replace";
  }
  return canManuallySearchLibraryItem(item) ? "search" : null;
}

export function LibraryCard({
  item,
  onManage,
  onGenreSelect,
}: {
  item: LibraryItem;
  onManage: (item: LibraryItem) => void;
  onGenreSelect?: (genreId: number) => void;
}) {
  const { messages } = useUi();
  const poster = imageUrl(item.posterPath, "w342");
  const rating =
    item.rating ??
    (item.voteAverage !== undefined && item.voteAverage !== null
      ? { source: "tmdb" as const, value: item.voteAverage, votes: null }
      : null);
  const activeDownload = item.activeDownload ?? null;
  const storage = item.storage;
  const episodeProgress = item.episodeProgress;
  const nextAirDate = item.nextAirDate;
  const episodePercent = episodeProgress?.total
    ? Math.round((episodeProgress.available / episodeProgress.total) * 100)
    : undefined;
  const downloadPercent = activeDownload
    ? toPercent(activeDownload.progress)
    : undefined;
  const activeDownloadPath = storage?.downloadPath;
  const locationPath = activeDownload
    ? (activeDownloadPath ?? storage?.libraryPath)
    : (storage?.libraryPath ?? storage?.downloadPath);
  let locationLabel = messages.library.downloadFolder;
  if (activeDownload && activeDownloadPath)
    locationLabel = messages.library.downloadingTo;
  else if (storage?.libraryPath) locationLabel = messages.library.inLibrary;
  const storageDetails = [
    storage?.quality ?? undefined,
    storage && storage.fileCount > 0
      ? messages.common.files({ count: storage.fileCount })
      : undefined,
    storage && storage.totalBytes > 0
      ? formatBytes(storage.totalBytes)
      : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  const visibleGenres = item.genres?.slice(0, 2) ?? [];
  const remainingGenres = Math.max(0, (item.genres?.length ?? 0) - 2);
  const cardTitle = locationPath
    ? `${item.title} · ${locationLabel}: ${locationPath}`
    : messages.library.openDetails({ title: item.title });
  return (
    <article className="library-card">
      <div className="library-card__poster">
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <span className="poster-placeholder">{initials(item.title)}</span>
        )}
      </div>
      <div className="library-card__body">
        <div className="library-card__heading">
          <div>
            <h3>{item.title}</h3>
            <p>
              {mediaYear(item) ?? messages.dates.tba} ·{" "}
              {item.kind === "movie"
                ? messages.kind.movie
                : messages.kind.series}
            </p>
          </div>
          {rating && rating.value > 0 ? (
            <span
              className="library-card__rating"
              aria-label={
                rating.votes === null
                  ? messages.common.ratingAria({
                      source: rating.source.toUpperCase(),
                      value: rating.value.toFixed(1),
                      scale: 10,
                    })
                  : messages.common.ratingVotesAria({
                      source: rating.source.toUpperCase(),
                      value: rating.value.toFixed(1),
                      scale: 10,
                      votes: rating.votes.toLocaleString(),
                    })
              }
            >
              <Star size={13} fill="currentColor" aria-hidden="true" />
              <strong>{rating.value.toFixed(1)}</strong>
              {rating.votes !== null ? (
                <small>{compactVoteCount(rating.votes)}</small>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="library-card__labels">
          <Badge tone={acquisitionTone(item.acquisitionState)}>
            {downloadStateLabel(item.acquisitionState, messages)}
          </Badge>
          {visibleGenres.length > 0 ? (
            <span
              className="library-card__genres"
              aria-label={messages.common.genres}
            >
              {visibleGenres.map((genre) =>
                onGenreSelect ? (
                  <button
                    type="button"
                    key={genre.id}
                    className="library-card__genre"
                    onClick={(event) => {
                      event.stopPropagation();
                      onGenreSelect(genre.id);
                    }}
                  >
                    {genre.name}
                  </button>
                ) : (
                  <span key={genre.id}>{genre.name}</span>
                ),
              )}
              {remainingGenres > 0 ? <span>+{remainingGenres}</span> : null}
            </span>
          ) : null}
        </div>

        {activeDownload && downloadPercent !== undefined ? (
          <div className="library-card__download">
            <div className="library-card__progress-heading">
              <span>
                <ArrowDown size={13} aria-hidden="true" />
                {downloadStateLabel(activeDownload.state, messages)}
              </span>
              <strong>{downloadPercent}%</strong>
            </div>
            <ProgressBar
              value={downloadPercent}
              label={messages.common.downloadProgress({ title: item.title })}
            />
            <div className="library-card__download-stats">
              {activeDownload.totalBytes > 0 ? (
                <span>
                  {messages.common.bytesOf({
                    from: formatBytes(activeDownload.downloadedBytes),
                    to: formatBytes(activeDownload.totalBytes),
                  })}
                </span>
              ) : null}
              {activeDownload.downloadRate > 0 ? (
                <span>{formatRate(activeDownload.downloadRate)}</span>
              ) : null}
              {activeDownload.etaSeconds !== null ? (
                <span>
                  {messages.common.eta({
                    value: formatEta(activeDownload.etaSeconds),
                  })}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {episodePercent !== undefined ? (
          <div
            className={`library-card__availability${
              activeDownload ? " library-card__availability--compact" : ""
            }`}
          >
            <div>
              <span>
                {messages.library.episodesReady({
                  ready: episodeProgress?.available ?? 0,
                  total: episodeProgress?.total ?? 0,
                })}
              </span>
              <strong>{episodePercent}%</strong>
            </div>
            {!activeDownload ? (
              <ProgressBar
                value={episodePercent}
                label={messages.library.episodeAvailability({
                  title: item.title,
                })}
              />
            ) : null}
          </div>
        ) : null}

        {locationPath ? (
          <div className="library-card__location" title={locationPath}>
            <FolderOpen size={14} aria-hidden="true" />
            <span>
              <small>{locationLabel}</small>
              <strong>{locationPath}</strong>
            </span>
          </div>
        ) : null}
        {storageDetails.length > 0 ? (
          <p className="library-card__storage-meta">
            {storageDetails.join(" · ")}
          </p>
        ) : null}

        {nextAirDate ? (
          <p className="library-card__date">
            <CalendarClock size={13} aria-hidden="true" />
            {messages.library.nextEpisode({
              date: formatDate(nextAirDate) ?? messages.dates.unknown,
            })}
          </p>
        ) : null}

        {!activeDownload && item.acquisitionState === "missing" ? (
          <p className="library-card__helper">
            <Search size={13} aria-hidden="true" />
            {messages.library.noFileYet}
          </p>
        ) : null}
        {!activeDownload && item.acquisitionState === "failed" ? (
          <p className="library-card__helper library-card__helper--danger">
            <CircleAlert size={13} aria-hidden="true" />
            {messages.library.acquisitionNeedsAttention}
          </p>
        ) : null}
        {!activeDownload &&
        item.kind === "movie" &&
        item.monitorPolicy === "none" &&
        libraryItemHasFile(item) ? (
          <p className="library-card__helper">
            <Settings2 size={13} aria-hidden="true" />
            {messages.library.openToReplace}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="library-card__hit-area"
        aria-label={messages.library.openDetails({ title: item.title })}
        title={cardTitle}
        onClick={() => onManage(item)}
      />
    </article>
  );
}

function LibraryManualReleaseSearch({
  item,
  seasons,
  seasonsLoading,
  seasonsError,
  initialSeason,
  initialEpisode,
  onRetrySeasons,
  onBack,
}: {
  item: LibraryItem;
  seasons: LibraryItem[];
  seasonsLoading: boolean;
  seasonsError: Error | null;
  initialSeason?: number;
  initialEpisode?: number | null;
  onRetrySeasons: () => void;
  onBack: () => void;
}) {
  const monitoredSeasons = useMemo(
    () =>
      seasons.filter(
        (season) =>
          season.monitorPolicy !== "none" &&
          isPositiveSafeInteger(season.seasonNumber),
      ),
    [seasons],
  );
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>(
    initialSeason,
  );
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(
    initialEpisode ?? null,
  );
  const [defaultedSeason, setDefaultedSeason] = useState<number | undefined>(
    initialSeason,
  );

  useEffect(() => {
    if (item.kind !== "series" || selectedSeason !== undefined) return;
    const newestActive = monitoredSeasons.findLast((season) =>
      ["queued", "downloading"].includes(season.acquisitionState),
    );
    const newestActionable = monitoredSeasons.findLast((season) =>
      ["missing", "failed", "queued", "downloading"].includes(
        season.acquisitionState,
      ),
    );
    const newestMonitored = monitoredSeasons.at(-1);
    setSelectedSeason(
      newestActive?.seasonNumber ??
        newestActionable?.seasonNumber ??
        newestMonitored?.seasonNumber ??
        undefined,
    );
  }, [item.kind, monitoredSeasons, selectedSeason]);

  const selectedSeasonItem = monitoredSeasons.find(
    (season) => season.seasonNumber === selectedSeason,
  );
  const episodeQuery = useQuery({
    queryKey: ["library", "episodes", selectedSeasonItem?.id],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: { parentId: selectedSeasonItem?.id, limit: 100 },
        signal,
      }),
    enabled: Boolean(selectedSeasonItem?.id),
  });
  const actionableEpisodes = useMemo(
    () =>
      collectionItems(episodeQuery.data)
        .filter(
          (episode) =>
            episode.kind === "episode" &&
            episode.monitorPolicy !== "none" &&
            ["missing", "failed", "queued", "downloading"].includes(
              episode.acquisitionState,
            ) &&
            isPositiveSafeInteger(episode.episodeNumber),
        )
        .sort(
          (left, right) =>
            (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0),
        ),
    [episodeQuery.data],
  );
  useEffect(() => {
    if (
      selectedSeason === undefined ||
      defaultedSeason === selectedSeason ||
      episodeQuery.isLoading
    ) {
      return;
    }
    setSelectedEpisode(
      defaultEpisodeReleaseTarget(
        selectedSeasonItem,
        collectionItems(episodeQuery.data),
      ),
    );
    setDefaultedSeason(selectedSeason);
  }, [
    defaultedSeason,
    episodeQuery.data,
    episodeQuery.isLoading,
    selectedSeason,
    selectedSeasonItem,
  ]);
  const target = libraryReleaseTarget(item, selectedSeason, selectedEpisode);
  const hasValidTmdbId = isPositiveSafeInteger(item.tmdbId);
  const { messages } = useUi();

  return (
    <div className="stack">
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          {messages.library.backToManagement}
        </Button>
        <p className="muted">{messages.library.searchJackettHelp}</p>
      </div>

      {item.kind === "series" && seasonsLoading ? (
        <InlineSpinner label={messages.library.loadingMonitoredSeasons} />
      ) : null}
      {item.kind === "series" && seasonsError ? (
        <ErrorState error={seasonsError} onRetry={onRetrySeasons} />
      ) : null}
      {item.kind === "series" &&
      !seasonsLoading &&
      !seasonsError &&
      monitoredSeasons.length > 0 ? (
        <div className="form-grid">
          <SelectField
            label={messages.library.seasonField}
            hint={messages.library.seasonHint}
            value={selectedSeason ?? ""}
            onChange={(event) => {
              setSelectedSeason(Number(event.currentTarget.value));
              setSelectedEpisode(null);
              setDefaultedSeason(undefined);
            }}
          >
            {monitoredSeasons.map((season) => (
              <option value={season.seasonNumber ?? ""} key={season.id}>
                {messages.library.season({ n: season.seasonNumber ?? 0 })}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={messages.library.releaseTarget}
            hint={messages.library.releaseTargetHint}
            value={selectedEpisode ?? "season"}
            disabled={episodeQuery.isLoading}
            onChange={(event) =>
              setSelectedEpisode(
                event.currentTarget.value === "season"
                  ? null
                  : Number(event.currentTarget.value),
              )
            }
          >
            <option value="season">{messages.library.entireSeasonPack}</option>
            {actionableEpisodes.map((episode) => (
              <option value={episode.episodeNumber ?? ""} key={episode.id}>
                S{String(selectedSeason).padStart(2, "0")}E
                {String(episode.episodeNumber).padStart(2, "0")} ·
                {episode.title}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      {item.kind === "series" &&
      !seasonsLoading &&
      !seasonsError &&
      monitoredSeasons.length === 0 ? (
        <EmptyState
          title={messages.library.noMonitoredSeasons}
          description={messages.library.noMonitoredSeasonsDescription}
        />
      ) : null}
      {episodeQuery.isError ? (
        <ErrorState
          error={episodeQuery.error}
          onRetry={() => void episodeQuery.refetch()}
        />
      ) : null}
      {target ? (
        <ReleaseSearchPanel
          key={`${target.kind}:${target.tmdbId}:${target.season ?? "movie"}:${target.episode ?? "all"}`}
          target={target}
        />
      ) : null}
      {!target && !hasValidTmdbId ? (
        <div className="notice notice--error" role="alert">
          {messages.library.noTmdbMatch}
        </div>
      ) : null}
    </div>
  );
}

function EpisodeStatusIcon({ status }: { status: EpisodeDisplayStatus }) {
  if (status.state === "ready")
    return <CircleCheck size={15} aria-hidden="true" />;
  if (status.active) return <ArrowDown size={15} aria-hidden="true" />;
  if (status.needsAttention)
    return <CircleAlert size={15} aria-hidden="true" />;
  if (status.state === "unmonitored")
    return <EyeOff size={15} aria-hidden="true" />;
  return <CalendarClock size={15} aria-hidden="true" />;
}

function GuidanceIcon({ tone }: { tone: string }) {
  if (tone === "danger") return <CircleAlert size={21} />;
  if (tone === "info") return <Clock3 size={21} />;
  return <CircleCheck size={21} />;
}

function episodeDateCopy(
  episode: LibraryItem,
  status: EpisodeDisplayStatus,
  now = Date.now(),
  messages: Messages = en,
): string {
  if (status.state === "ready") return messages.library.fileReady;
  if (status.state === "searching") return messages.library.checkingIndexers;
  if (status.state === "queued") return messages.library.releaseSelected;
  if (status.state === "organizing") return messages.library.movingFile;
  if (status.state === "downloading") {
    const progress = episode.activeDownload
      ? messages.library.percentDownloaded({
          percent: toPercent(episode.activeDownload.progress),
        })
      : messages.library.downloadInProgress;
    return episode.activeDownload?.etaSeconds === null ||
      episode.activeDownload?.etaSeconds === undefined
      ? progress
      : `${progress} · ${messages.common.eta({ value: formatEta(episode.activeDownload.etaSeconds) })}`;
  }
  if (status.state === "failed") return messages.library.automaticFailed;
  if (status.state === "unmonitored")
    return messages.library.ignoredByMonitoring;
  if (status.state === "tba") return messages.library.airDateNotAnnounced;
  if (releaseDay(episode) === utcDay(now)) return messages.library.airsToday;
  if (status.state === "upcoming")
    return messages.library.airsOn({
      date: formatDate(episode.releaseDate!) ?? messages.dates.unknown,
    });
  return messages.library.airedMissingOn({
    date: formatDate(episode.releaseDate!) ?? messages.dates.unknown,
  });
}

function seasonStateCopy(
  season: LibraryItem,
  now = Date.now(),
  messages: Messages = en,
): string {
  if (
    ["searching", "queued", "downloading", "organizing"].includes(
      season.acquisitionState,
    )
  ) {
    return downloadStateLabel(season.acquisitionState, messages);
  }
  if (
    season.acquisitionState === "available" ||
    (season.storage?.fileCount ?? 0) > 0
  ) {
    return season.monitorPolicy === "none"
      ? messages.library.readyMonitoringOff
      : messages.library.ready;
  }
  if (season.monitorPolicy === "none") return messages.library.notMonitored;
  if (season.acquisitionState === "failed")
    return messages.library.needsAttention;
  const airDay = releaseDay(season);
  if (airDay !== null && airDay >= utcDay(now))
    return messages.library.upcoming;
  return season.acquisitionState === "missing"
    ? messages.library.missingEpisodes
    : messages.library.tracked;
}

export function TvSeriesManagement({
  item,
  downloadFiles,
  seasons,
  seasonsLoading,
  seasonsError,
  policy,
  selectedSeasons,
  includeFutureSeasons,
  saveBusy,
  saveError,
  canMutate,
  onPolicyChange,
  onSelectedSeasonsChange,
  onIncludeFutureSeasonsChange,
  onRetrySeasons,
  onSave,
  onManualSearch,
  onRemove,
}: {
  item: LibraryItem;
  downloadFiles: LibraryDownloadFile[];
  seasons: LibraryItem[];
  seasonsLoading: boolean;
  seasonsError: Error | null;
  policy: MonitorPolicy;
  selectedSeasons: number[];
  includeFutureSeasons: boolean;
  saveBusy: boolean;
  saveError?: string;
  canMutate: boolean;
  onPolicyChange: (policy: MonitorPolicy) => void;
  onSelectedSeasonsChange: (seasons: number[]) => void;
  onIncludeFutureSeasonsChange: (include: boolean) => void;
  onRetrySeasons: () => void;
  onSave: () => void;
  onManualSearch: (target?: { season: number; episode: number | null }) => void;
  onRemove: () => void;
}) {
  const { messages } = useUi();
  const queryClient = useQueryClient();
  const displaySeasons = useMemo(
    () =>
      seasons.filter((season) => isPositiveSafeInteger(season.seasonNumber)),
    [seasons],
  );
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<
    number | undefined
  >();
  const [settingsOpen, setSettingsOpen] = useState(
    item.monitorPolicy === "none",
  );

  useEffect(() => {
    if (
      selectedSeasonNumber !== undefined &&
      displaySeasons.some(
        (season) => season.seasonNumber === selectedSeasonNumber,
      )
    ) {
      return;
    }
    setSelectedSeasonNumber(defaultTvSeasonNumber(displaySeasons));
  }, [displaySeasons, selectedSeasonNumber]);

  const selectedSeason = displaySeasons.find(
    (season) => season.seasonNumber === selectedSeasonNumber,
  );
  const monitoringOff = item.monitorPolicy === "none";
  const selectedSeasonIsMonitored =
    selectedSeason !== undefined && selectedSeason.monitorPolicy !== "none";
  const futureOnly =
    policy === "selected" &&
    selectedSeasons.length === 0 &&
    includeFutureSeasons;
  let monitoringSettingsSummary = messages.library.selectedSeasonsSummary({
    count: selectedSeasons.length,
    future: includeFutureSeasons,
  });
  if (policy === "none") {
    monitoringSettingsSummary = messages.library.automaticSearchesOff;
  } else if (futureOnly) {
    monitoringSettingsSummary = messages.library.futureSeasonsOnly;
  }
  const canConfigureMonitoring = isPositiveSafeInteger(item.tmdbId);
  const episodeQuery = useQuery({
    queryKey: ["library", "episodes", selectedSeason?.id],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: { parentId: selectedSeason?.id, limit: 100 },
        signal,
      }),
    enabled: Boolean(selectedSeason?.id),
  });
  const episodes = useMemo(
    () =>
      collectionItems(episodeQuery.data)
        .filter(
          (episode) =>
            episode.kind === "episode" &&
            isPositiveSafeInteger(episode.episodeNumber),
        )
        .sort(
          (left, right) =>
            (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0),
        ),
    [episodeQuery.data],
  );
  const summary = summarizeEpisodeStates(episodes);
  const firstMissing = episodes.find(
    (episode) => episodeDisplayStatus(episode).needsAttention,
  );
  const nextEpisode = episodes.find((episode) =>
    ["upcoming", "tba"].includes(episodeDisplayStatus(episode).state),
  );
  const seasonPackDownload =
    selectedSeason?.metadata?.["acquisitionMode"] === "season"
      ? (selectedSeason.activeDownload ?? null)
      : null;
  const retryMutation = useMutation({
    mutationFn: (id: string) =>
      api.post("retryLibraryItem", { params: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      void episodeQuery.refetch();
    },
  });
  const poster = imageUrl(item.posterPath, "w342");
  const overallReady = item.episodeProgress?.available ?? 0;
  const overallTotal = item.episodeProgress?.total ?? 0;
  const overallPercent = overallTotal
    ? Math.round((overallReady / overallTotal) * 100)
    : 0;
  const metadataSeasonCount =
    typeof item.metadata?.["numberOfSeasons"] === "number"
      ? item.metadata["numberOfSeasons"]
      : 0;
  const seasonOptions = monitoringSeasonNumbers(
    displaySeasons,
    metadataSeasonCount,
  );
  const storedFileCount = item.storage?.fileCount ?? 0;
  const selectedSeasonLabel = selectedSeasonNumber
    ? messages.library.season({ n: selectedSeasonNumber })
    : messages.library.thisSeason;

  let guideTitle = messages.library.seasonOnTrack;
  let guideCopy = messages.library.nothingToDo;
  let guideTone = "success";
  if (futureOnly) {
    guideTitle = messages.library.watchingFutureSeasons;
    guideCopy = messages.library.watchingFutureSeasonsCopy;
    guideTone = "success";
  } else if (monitoringOff || !selectedSeasonIsMonitored) {
    guideTitle = monitoringOff
      ? messages.library.monitoringOffShow
      : messages.library.seasonNotMonitored({ season: selectedSeasonLabel });
    guideCopy = canConfigureMonitoring
      ? messages.library.existingFilesStay
      : messages.library.confirmTmdbBeforeMonitoring;
    guideTone = "info";
  } else if (seasonPackDownload) {
    guideTitle = messages.library.seasonPackDownloadingTitle;
    guideCopy = messages.library.seasonPackDownloadingCopy;
    guideTone = "info";
  } else if (summary.missing > 0) {
    guideTitle = messages.library.airedMissingTitle({
      count: summary.missing,
    });
    guideCopy = messages.library.airedMissingCopy;
    guideTone = "danger";
  } else if (summary.active > 0) {
    guideTitle = messages.library.inProgressTitle({ count: summary.active });
    guideCopy = messages.library.inProgressCopy;
    guideTone = "info";
  } else if (summary.upcoming > 0) {
    guideTitle = messages.library.caughtUp;
    guideCopy = nextEpisode
      ? messages.library.willSearchAutomatically({
          copy: episodeDateCopy(
            nextEpisode,
            episodeDisplayStatus(nextEpisode, Date.now(), messages),
            Date.now(),
            messages,
          ),
        })
      : messages.library.futureEpisodesAuto;
  } else if (summary.total > 0 && summary.ready === summary.total) {
    guideTitle = messages.library.seasonComplete;
    guideCopy = messages.library.seasonCompleteCopy;
  }

  const openMonitoringSettings = () => {
    if (!canConfigureMonitoring) {
      setSettingsOpen(true);
      return;
    }
    onPolicyChange("selected");
    if (
      selectedSeasonNumber !== undefined &&
      !selectedSeasons.includes(selectedSeasonNumber)
    ) {
      onSelectedSeasonsChange(
        [...selectedSeasons, selectedSeasonNumber].sort(
          (left, right) => left - right,
        ),
      );
    }
    setSettingsOpen(true);
  };
  let overviewTitle = messages.library.overviewReadyToConfigure;
  let overviewDescription =
    item.overview || messages.library.overviewOpenSeason;
  if (monitoringOff) {
    overviewTitle = messages.library.monitoringIsOff;
    overviewDescription =
      storedFileCount > 0
        ? messages.library.existingFilesRemain({ count: storedFileCount })
        : messages.library.noAutomaticSearches;
  } else if (futureOnly) {
    overviewTitle = messages.library.futureSeasonMonitoringOn;
    overviewDescription = messages.library.futureSeasonMonitoringCopy;
  } else if (overallTotal > 0) {
    overviewTitle = messages.library.monitoredEpisodesReady({
      ready: overallReady,
      total: overallTotal,
    });
  }

  return (
    <div className="tv-management">
      <section
        className="tv-overview"
        aria-label={messages.library.showSummary}
      >
        <div className="tv-overview__poster" aria-hidden="true">
          {poster ? (
            <img src={poster} alt="" />
          ) : (
            <span className="poster-placeholder">{initials(item.title)}</span>
          )}
        </div>
        <div className="tv-overview__copy">
          <span className="tv-overview__eyebrow">
            {messages.library.libraryHealth}
          </span>
          <h3>{overviewTitle}</h3>
          <p>{overviewDescription}</p>
          {!monitoringOff && overallTotal > 0 && overallPercent < 100 ? (
            <div className="tv-overview__progress">
              <ProgressBar
                value={overallPercent}
                label={messages.library.overallEpisodeAvailability({
                  title: item.title,
                })}
              />
              <strong>{overallPercent}%</strong>
            </div>
          ) : null}
        </div>
      </section>

      {seasonsLoading ? (
        <InlineSpinner label={messages.library.loadingSeasons} />
      ) : null}
      {seasonsError ? (
        <ErrorState error={seasonsError} onRetry={onRetrySeasons} />
      ) : null}
      {displaySeasons.length > 0 ? (
        <nav className="tv-season-nav" aria-label={messages.library.seasons}>
          {displaySeasons.map((season) => (
            <button
              type="button"
              key={season.id}
              className={
                season.seasonNumber === selectedSeasonNumber
                  ? "is-active"
                  : undefined
              }
              aria-pressed={season.seasonNumber === selectedSeasonNumber}
              onClick={() =>
                setSelectedSeasonNumber(season.seasonNumber ?? undefined)
              }
            >
              <span>
                {messages.library.season({ n: season.seasonNumber ?? 0 })}
              </span>
              <small>{seasonStateCopy(season, Date.now(), messages)}</small>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="tv-season-layout">
        {selectedSeason ? (
          <section className="tv-episodes" aria-labelledby="episode-list-title">
            <header className="tv-episodes__header">
              <div>
                <span className="tv-overview__eyebrow">
                  {messages.library.episodeStatus}
                </span>
                <h3 id="episode-list-title">{selectedSeasonLabel}</h3>
              </div>
              {episodes.length > 0 ? (
                <span className="tv-episodes__count">
                  {messages.library.readyOfTotal({
                    ready: summary.ready,
                    total: summary.total,
                  })}
                </span>
              ) : null}
            </header>

            {seasonPackDownload ? (
              <div className="season-download" role="status">
                <div>
                  <span>
                    <ArrowDown size={15} aria-hidden="true" />{" "}
                    {messages.library.seasonPackDownloading}
                  </span>
                  <strong>{toPercent(seasonPackDownload.progress)}%</strong>
                </div>
                <ProgressBar
                  value={toPercent(seasonPackDownload.progress)}
                  label={messages.library.packDownloadProgress({
                    season: selectedSeasonLabel,
                  })}
                />
              </div>
            ) : null}

            {episodes.length > 0 ? (
              <dl
                className="episode-summary"
                aria-label={messages.library.seasonSummary}
              >
                <div className="episode-summary__ready">
                  <dt>{messages.library.ready}</dt>
                  <dd>{summary.ready}</dd>
                </div>
                <div className="episode-summary__active">
                  <dt>{messages.library.inProgress}</dt>
                  <dd>{summary.active}</dd>
                </div>
                <div className="episode-summary__missing">
                  <dt>{messages.library.airedAndMissing}</dt>
                  <dd>{summary.missing}</dd>
                </div>
                <div>
                  <dt>
                    {summary.unmonitored > 0
                      ? messages.library.notMonitored
                      : messages.library.upcomingTba}
                  </dt>
                  <dd>
                    {summary.unmonitored > 0
                      ? summary.unmonitored
                      : summary.upcoming}
                  </dd>
                </div>
              </dl>
            ) : null}

            {episodeQuery.isLoading ? (
              <InlineSpinner label={messages.library.loadingEpisodes} />
            ) : null}
            {episodeQuery.isError ? (
              <ErrorState
                error={episodeQuery.error}
                onRetry={() => void episodeQuery.refetch()}
              />
            ) : null}
            {episodeQuery.isSuccess && episodes.length === 0 ? (
              <EmptyState
                title={messages.library.noEpisodeDetails}
                description={messages.library.noEpisodeDetailsDescription}
              />
            ) : null}
            {episodes.length > 0 ? (
              <div className="episode-list" role="list">
                {episodes.map((episode) => {
                  const status = episodeDisplayStatus(
                    episode,
                    Date.now(),
                    messages,
                  );
                  const episodeNumber = episode.episodeNumber!;
                  const code = `S${String(selectedSeasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
                  const still = imageUrl(episode.posterPath, "w342");
                  const episodeFiles = downloadFiles.filter(
                    (file) => file.mediaId === episode.id,
                  );
                  return (
                    <article
                      className={`episode-row episode-row--${status.state}`}
                      role="listitem"
                      key={episode.id}
                    >
                      <div className="episode-row__still" aria-hidden="true">
                        {still ? (
                          <img src={still} alt="" loading="lazy" />
                        ) : (
                          <ListVideo size={19} />
                        )}
                      </div>
                      <div className="episode-row__copy">
                        <span>{code}</span>
                        <strong>{episode.title}</strong>
                        <small>
                          {episodeDateCopy(
                            episode,
                            status,
                            Date.now(),
                            messages,
                          )}
                        </small>
                      </div>
                      <Badge tone={status.tone} className="episode-row__status">
                        <EpisodeStatusIcon status={status} />
                        {status.label}
                      </Badge>
                      {episodeFiles.length > 0 || status.needsAttention ? (
                        <div className="episode-row__actions">
                          {episodeFiles.map((file) => (
                            <a
                              key={file.id}
                              className="button button--secondary button--sm"
                              href={file.downloadUrl}
                              download={file.name}
                              aria-label={
                                episodeFiles.length > 1
                                  ? messages.library.downloadEpisodeFile({
                                      code,
                                      title: episode.title,
                                      file: file.name,
                                    })
                                  : messages.library.downloadEpisode({
                                      code,
                                      title: episode.title,
                                    })
                              }
                            >
                              <Download size={14} /> {messages.common.download}
                            </a>
                          ))}
                          {canMutate && status.needsAttention ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              aria-label={messages.library.findReleaseFor({
                                code,
                                title: episode.title,
                              })}
                              onClick={() =>
                                onManualSearch({
                                  season: selectedSeasonNumber!,
                                  episode: episodeNumber,
                                })
                              }
                            >
                              <Search size={14} />{" "}
                              {messages.library.findRelease}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : (
          <section
            className="tv-episodes"
            aria-label={messages.library.episodeStatus}
          >
            <EmptyState
              title={
                seasonsLoading
                  ? messages.library.loadingSeasonDetails
                  : messages.library.noSeasonDetails
              }
              description={
                seasonsError
                  ? messages.library.retrySeasonsDescription
                  : messages.library.chooseMonitoringDescription
              }
            />
          </section>
        )}

        <aside
          className="tv-guidance"
          aria-label={messages.library.recommendedActions}
        >
          <section
            className={`tv-guidance__card tv-guidance__card--${guideTone}`}
          >
            <span className="tv-guidance__icon" aria-hidden="true">
              <GuidanceIcon tone={guideTone} />
            </span>
            <div>
              <span className="tv-overview__eyebrow">
                {messages.library.whatToDoNext}
              </span>
              <h3>{guideTitle}</h3>
              <p>{guideCopy}</p>
            </div>
            {canMutate &&
            !futureOnly &&
            (monitoringOff || !selectedSeasonIsMonitored) ? (
              <Button
                type="button"
                disabled={!canConfigureMonitoring}
                onClick={openMonitoringSettings}
              >
                <Settings2 size={15} /> {messages.library.chooseMonitoring}
              </Button>
            ) : null}
            {canMutate && selectedSeasonIsMonitored && firstMissing ? (
              <Button
                type="button"
                onClick={() =>
                  onManualSearch({
                    season: selectedSeasonNumber!,
                    episode: firstMissing.episodeNumber!,
                  })
                }
              >
                <Search size={15} /> {messages.library.findFirstMissing}
              </Button>
            ) : null}
            {canMutate &&
            selectedSeasonIsMonitored &&
            selectedSeason &&
            summary.missing > 0 ? (
              <Button
                type="button"
                variant="secondary"
                busy={retryMutation.isPending}
                onClick={() => retryMutation.mutate(selectedSeason.id)}
              >
                <RefreshCw size={15} /> {messages.library.retryAutomaticSearch}
              </Button>
            ) : null}
            {retryMutation.isError ? (
              <div className="notice notice--error" role="alert">
                {retryMutation.error.message}
              </div>
            ) : null}
          </section>

          {canMutate && selectedSeasonIsMonitored ? (
            <Button
              type="button"
              variant="secondary"
              className="tv-guidance__manual"
              onClick={() =>
                onManualSearch(
                  selectedSeasonNumber
                    ? { season: selectedSeasonNumber, episode: null }
                    : undefined,
                )
              }
            >
              <Search size={15} /> {messages.library.searchAnyRelease}
            </Button>
          ) : null}

          {canMutate ? (
            <details
              className="tv-settings"
              open={settingsOpen}
              onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
            >
              <summary>
                <Settings2 size={18} aria-hidden="true" />
                <span>
                  <strong>{messages.library.monitoringSettings}</strong>
                  <small>{monitoringSettingsSummary}</small>
                </span>
              </summary>
              <div className="tv-settings__content">
                <label className="field">
                  <span className="field__label">
                    {messages.library.automaticMonitoring}
                  </span>
                  <SelectControl
                    value={policy}
                    disabled={!canConfigureMonitoring}
                    onChange={(event) =>
                      onPolicyChange(event.target.value as MonitorPolicy)
                    }
                  >
                    <option value="none">
                      {messages.library.doNotMonitor}
                    </option>
                    <option value="selected">
                      {messages.library.selectedSeasons}
                    </option>
                    <option value="all">
                      {messages.library.allCurrentSeasons}
                    </option>
                  </SelectControl>
                  <span className="field__hint">
                    {messages.library.automaticMonitoringHint}
                  </span>
                </label>
                {policy === "selected" ? (
                  <div
                    className="season-monitor__grid tv-settings__seasons"
                    aria-label={messages.library.chooseMonitoredSeasons}
                  >
                    {seasonOptions.map((season) => (
                      <label className="season-choice" key={season}>
                        <input
                          type="checkbox"
                          disabled={!canConfigureMonitoring}
                          checked={selectedSeasons.includes(season)}
                          onChange={(event) =>
                            onSelectedSeasonsChange(
                              event.target.checked
                                ? [...selectedSeasons, season].sort(
                                    (left, right) => left - right,
                                  )
                                : selectedSeasons.filter(
                                    (value) => value !== season,
                                  ),
                            )
                          }
                        />
                        <span>{messages.library.season({ n: season })}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {policy !== "none" ? (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      disabled={!canConfigureMonitoring}
                      checked={includeFutureSeasons}
                      onChange={(event) =>
                        onIncludeFutureSeasonsChange(event.target.checked)
                      }
                    />
                    <span>
                      <strong>{messages.library.monitorFutureSeasons}</strong>
                      <small>{messages.library.monitorFutureSeasonsHint}</small>
                    </span>
                  </label>
                ) : null}
                {saveError ? (
                  <div className="notice notice--error" role="alert">
                    {saveError}
                  </div>
                ) : null}
                {!canConfigureMonitoring ? (
                  <div className="notice notice--warning" role="note">
                    {messages.library.confirmTmdbMatchShow}
                  </div>
                ) : null}
                <Button
                  type="button"
                  busy={saveBusy}
                  disabled={
                    !canConfigureMonitoring ||
                    (policy === "selected" &&
                      selectedSeasons.length === 0 &&
                      !includeFutureSeasons)
                  }
                  onClick={onSave}
                >
                  <Check size={15} /> {messages.library.saveMonitoring}
                </Button>
              </div>
            </details>
          ) : null}

          {canMutate ? (
            <Button
              type="button"
              variant="ghost"
              className="danger-text tv-guidance__remove"
              onClick={onRemove}
            >
              <Trash2 size={15} />
              {monitoringOff
                ? messages.library.removeFromLibrary
                : messages.library.removeShow}
            </Button>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export function MovieManagement({
  item,
  actors,
  actorsLoading = false,
  trailer,
  downloadFiles = [],
  policy,
  saveBusy,
  saveError,
  retryBusy,
  retryError,
  canMutate,
  onPolicyChange,
  onSave,
  onRetry,
  onManualSearch,
  onActorSelect,
  onBrowseSimilar,
  onRemove,
}: {
  item: LibraryItem;
  actors?: CatalogActor[];
  actorsLoading?: boolean;
  trailer?: CatalogTrailer | null;
  downloadFiles?: LibraryDownloadFile[];
  policy: MonitorPolicy;
  saveBusy: boolean;
  saveError?: string;
  retryBusy: boolean;
  retryError?: string;
  canMutate: boolean;
  onPolicyChange: (policy: MonitorPolicy) => void;
  onSave: () => void;
  onRetry: () => void;
  onManualSearch: () => void;
  onActorSelect?: (actor: CatalogActor) => void;
  onBrowseSimilar?: () => void;
  onRemove: () => void;
}) {
  const { messages } = useUi();
  const [settingsOpen, setSettingsOpen] = useState(!libraryItemHasFile(item));
  const poster = imageUrl(item.posterPath, "w342");
  const hasLibraryFile = libraryItemHasFile(item);
  const hasTmdbMatch = isPositiveSafeInteger(item.tmdbId);
  const monitoringOn = item.monitorPolicy !== "none";
  const showMonitoringSettings = !hasLibraryFile || monitoringOn;
  const manualReleaseAction = libraryManualReleaseAction(item);
  const retryable =
    monitoringOn && ["missing", "failed"].includes(item.acquisitionState);
  const activeDownload = item.activeDownload ?? null;
  const storage = item.storage;
  const locationPath = hasLibraryFile
    ? storage?.libraryPath
    : (storage?.downloadPath ?? storage?.libraryPath);
  const storageDetails = [
    storage?.quality ?? undefined,
    storage && storage.fileCount > 0
      ? messages.common.files({ count: storage.fileCount })
      : undefined,
    storage && storage.totalBytes > 0
      ? formatBytes(storage.totalBytes)
      : undefined,
  ].filter((detail): detail is string => Boolean(detail));

  let overviewTitle = messages.library.noFileInLibrary;
  let overviewCopy = monitoringOn
    ? messages.library.monitoringCanSearch
    : messages.library.monitoringOffTurnOn;
  if (hasLibraryFile) {
    overviewTitle = messages.library.readyInLibrary;
    overviewCopy = monitoringOn
      ? messages.library.readyMonitoringOn
      : messages.library.readyMonitoringOffMovie;
  } else if (activeDownload) {
    overviewTitle = messages.library.workingOnRelease({
      state: downloadStateLabel(activeDownload.state, messages),
    });
    overviewCopy = messages.library.workingOnReleaseCopy;
  } else if (item.acquisitionState === "failed") {
    overviewTitle = messages.library.acquisitionNeedsAttentionTitle;
    overviewCopy = messages.library.acquisitionNeedsAttentionCopy;
  } else if (item.monitorPolicy === "none") {
    overviewTitle = messages.library.notMonitoredNoFile;
  }

  const statusLabel = hasLibraryFile
    ? messages.status.available
    : downloadStateLabel(item.acquisitionState, messages);
  let monitoringSummary = messages.library.monitoringOnSummary;
  if (item.monitorPolicy === "none") {
    monitoringSummary = hasLibraryFile
      ? messages.library.monitoringOffReplacement
      : messages.library.monitoringOffNoSearch;
  }

  return (
    <div className="movie-management">
      <section
        className="movie-overview"
        aria-label={messages.library.movieSummary}
      >
        <div className="movie-overview__poster" aria-hidden="true">
          {poster ? (
            <img src={poster} alt="" />
          ) : (
            <span className="poster-placeholder">{initials(item.title)}</span>
          )}
        </div>
        <div className="movie-overview__copy">
          <div className="movie-overview__heading">
            <div>
              <span className="tv-overview__eyebrow">
                {messages.library.libraryStatus}
              </span>
              <h3>{overviewTitle}</h3>
            </div>
            <Badge tone={acquisitionTone(item.acquisitionState)}>
              {statusLabel}
            </Badge>
          </div>
          <p>{overviewCopy}</p>
          <div className="movie-overview__actions">
            <WatchTrailerButton
              trailer={trailer}
              title={item.title}
              className="movie-overview__trailer"
            />
            {onBrowseSimilar ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onBrowseSimilar}
              >
                <Compass size={15} /> {messages.library.moreLikeThis}
              </Button>
            ) : null}
          </div>
          {activeDownload ? (
            <div className="movie-overview__progress">
              <ProgressBar
                value={toPercent(activeDownload.progress)}
                label={messages.common.downloadProgress({ title: item.title })}
              />
              <strong>{toPercent(activeDownload.progress)}%</strong>
            </div>
          ) : null}
        </div>
      </section>

      <MovieCast
        actors={actors}
        loading={actorsLoading}
        onSelect={onActorSelect ?? (() => undefined)}
      />

      <div className="movie-management__layout">
        <section
          className="movie-file-panel"
          aria-labelledby="movie-file-title"
        >
          <header className="movie-section-heading">
            <span className="movie-section-heading__icon" aria-hidden="true">
              {hasLibraryFile ? <FolderOpen size={19} /> : <Film size={19} />}
            </span>
            <div>
              <span className="tv-overview__eyebrow">
                {hasLibraryFile
                  ? messages.library.currentCopy
                  : messages.library.acquisition}
              </span>
              <h3 id="movie-file-title">
                {hasLibraryFile
                  ? messages.library.movieFile
                  : messages.library.findThisMovie}
              </h3>
            </div>
          </header>

          {locationPath ? (
            <div className="movie-file-panel__location" title={locationPath}>
              <small>
                {hasLibraryFile
                  ? messages.library.inLibrary
                  : messages.library.downloadingTo}
              </small>
              <strong>{locationPath}</strong>
            </div>
          ) : (
            <div className="movie-file-panel__empty">
              <Film size={22} aria-hidden="true" />
              <span>
                <strong>{messages.library.noOrganizedFile}</strong>
                <small>
                  {monitoringOn
                    ? messages.library.searchOrRetry
                    : messages.library.turnOnMonitoring}
                </small>
              </span>
            </div>
          )}

          {storageDetails.length > 0 ? (
            <p className="movie-file-panel__meta">
              {storageDetails.join(" · ")}
            </p>
          ) : null}

          {downloadFiles.length > 0 ? (
            <div
              className="movie-file-panel__downloads"
              aria-label={messages.library.movieDownloads}
            >
              {downloadFiles.map((file) => (
                <a
                  key={file.id}
                  className="button button--secondary button--sm"
                  href={file.downloadUrl}
                  download={file.name}
                  title={file.name}
                >
                  <Download size={15} />{" "}
                  {downloadFiles.length === 1
                    ? messages.library.downloadMovie
                    : messages.library.downloadNamed({ name: file.name })}
                </a>
              ))}
            </div>
          ) : null}

          {activeDownload ? (
            <dl
              className="movie-download-facts"
              aria-label={messages.library.downloadStatus}
            >
              <div>
                <dt>{messages.library.downloaded}</dt>
                <dd>
                  {messages.common.bytesOf({
                    from: formatBytes(activeDownload.downloadedBytes),
                    to: formatBytes(activeDownload.totalBytes),
                  })}
                </dd>
              </div>
              <div>
                <dt>{messages.common.speed}</dt>
                <dd>{formatRate(activeDownload.downloadRate)}</dd>
              </div>
              <div>
                <dt>ETA</dt>
                <dd>
                  {activeDownload.etaSeconds === null
                    ? messages.common.calculating
                    : formatEta(activeDownload.etaSeconds)}
                </dd>
              </div>
            </dl>
          ) : null}

          <div className="movie-file-panel__action">
            {canMutate && manualReleaseAction === "replace" ? (
              <>
                <div>
                  <h4>
                    {hasLibraryFile
                      ? messages.library.wantDifferentCopy
                      : messages.library.chooseAnotherRelease}
                  </h4>
                  <p>
                    {hasLibraryFile
                      ? messages.library.replacementCopy
                      : messages.library.replaceActive}
                  </p>
                </div>
                <Button type="button" onClick={onManualSearch}>
                  <RefreshCw size={16} /> {messages.library.chooseReplacement}
                </Button>
              </>
            ) : null}
            {canMutate && manualReleaseAction === "search" ? (
              <>
                <div>
                  <h4>{messages.library.chooseReleaseYourself}</h4>
                  <p>{messages.library.reviewJackett}</p>
                </div>
                <Button type="button" onClick={onManualSearch}>
                  <Search size={16} /> {messages.library.searchReleasesManually}
                </Button>
              </>
            ) : null}
            {!hasTmdbMatch ? (
              <div className="notice notice--warning" role="note">
                {messages.library.confirmMovieTmdb}
              </div>
            ) : null}
            {canMutate && retryable ? (
              <Button
                type="button"
                variant="secondary"
                busy={retryBusy}
                onClick={onRetry}
              >
                <RefreshCw size={16} /> {messages.library.retryAutomaticSearch}
              </Button>
            ) : null}
            {retryError ? (
              <div className="notice notice--error" role="alert">
                {retryError}
              </div>
            ) : null}
          </div>
        </section>

        <aside
          className="movie-controls"
          aria-label={messages.library.movieManagement}
        >
          {canMutate && showMonitoringSettings ? (
            <details
              className="tv-settings movie-settings"
              open={settingsOpen}
              onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
            >
              <summary>
                <Settings2 size={18} aria-hidden="true" />
                <span>
                  <strong>{messages.library.automaticMonitoring}</strong>
                  <small>{monitoringSummary}</small>
                </span>
              </summary>
              <div className="tv-settings__content">
                <label className="field">
                  <span className="field__label">
                    {messages.library.automaticMonitoring}
                  </span>
                  <SelectControl
                    value={policy}
                    disabled={!hasTmdbMatch}
                    onChange={(event) =>
                      onPolicyChange(event.target.value as MonitorPolicy)
                    }
                  >
                    <option value="none">
                      {hasLibraryFile
                        ? messages.library.offKeepCurrent
                        : messages.library.offDoNotAcquire}
                    </option>
                    <option value="all">
                      {messages.library.onSearchIfMissing}
                    </option>
                  </SelectControl>
                  <span className="field__hint">
                    {messages.library.replacementNoMonitoring}
                  </span>
                </label>
                {saveError ? (
                  <div className="notice notice--error" role="alert">
                    {saveError}
                  </div>
                ) : null}
                {!hasTmdbMatch ? (
                  <div className="notice notice--warning" role="note">
                    {messages.library.confirmMovieTmdbMonitoring}
                  </div>
                ) : null}
                <Button
                  type="button"
                  busy={saveBusy}
                  disabled={!hasTmdbMatch || policy === item.monitorPolicy}
                  onClick={onSave}
                >
                  <Check size={15} /> {messages.library.saveMonitoring}
                </Button>
              </div>
            </details>
          ) : null}

          {canMutate ? (
            <section className="movie-removal">
              <div>
                <span className="tv-overview__eyebrow">
                  {messages.library.libraryCleanup}
                </span>
                <h3>{messages.library.removeThisMovie}</h3>
                <p>
                  {hasLibraryFile
                    ? messages.library.removeRecordOrFile
                    : messages.library.removeMovieStopSearches}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="danger-text"
                onClick={onRemove}
              >
                <Trash2 size={15} /> {messages.library.removeFromLibrary}
              </Button>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ManageLibraryDialog({
  item,
  onClose,
}: {
  item: LibraryItem | null;
  onClose: () => void;
}) {
  const { messages } = useUi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const canMutate =
    sessionQuery.data?.user?.rank === "admin" || item?.ownedByMe === true;
  const [policy, setPolicy] = useState<MonitorPolicy>(
    item?.monitorPolicy === "future"
      ? "selected"
      : (item?.monitorPolicy ?? "all"),
  );
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>([]);
  const [seasonSelectionReady, setSeasonSelectionReady] = useState(false);
  const [includeFutureSeasons, setIncludeFutureSeasons] = useState(
    item?.monitorPolicy === "future" ||
      item?.metadata?.["includeFutureSeasons"] === true,
  );
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [manualSearchTarget, setManualSearchTarget] = useState<{
    season: number;
    episode: number | null;
  }>();
  const [deleteLibraryRecord, setDeleteLibraryRecord] = useState(false);
  const [deleteLibraryFiles, setDeleteLibraryFiles] = useState(false);
  const [deleteTorrent, setDeleteTorrent] = useState(false);
  const [deleteDownloadData, setDeleteDownloadData] = useState(false);
  const seasonQuery = useQuery({
    queryKey: ["library", "seasons", item?.id],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: { parentId: item?.id, limit: 100 },
        signal,
      }),
    enabled: item?.kind === "series",
  });
  const filesQuery = useQuery({
    queryKey: ["library", "files", item?.id],
    queryFn: ({ signal }) =>
      api.get("listLibraryFiles", {
        params: { id: itemId() },
        signal,
      }),
    enabled: Boolean(item),
  });
  const movieDetailsQuery = useQuery({
    queryKey: ["catalog", "detail", "movie", item?.tmdbId],
    queryFn: ({ signal }) =>
      api.get("catalogDetails", {
        params: { kind: "movie", tmdbId: item!.tmdbId! },
        signal,
      }),
    enabled: item?.kind === "movie" && isPositiveSafeInteger(item.tmdbId),
  });
  const downloadFiles = filesQuery.data?.files ?? [];
  const seasons = useMemo(
    () =>
      collectionItems(seasonQuery.data)
        .filter(
          (season) =>
            season.kind === "season" && typeof season.seasonNumber === "number",
        )
        .sort(
          (left, right) => (left.seasonNumber ?? 0) - (right.seasonNumber ?? 0),
        ),
    [seasonQuery.data],
  );

  useEffect(() => {
    if (
      seasonSelectionReady ||
      !seasonQuery.isSuccess ||
      seasonQuery.isFetching
    ) {
      return;
    }
    setSelectedSeasons(
      seasons.flatMap((season) =>
        season.monitorPolicy !== "none" && season.seasonNumber
          ? [season.seasonNumber]
          : [],
      ),
    );
    setSeasonSelectionReady(true);
  }, [
    seasonQuery.isFetching,
    seasonQuery.isSuccess,
    seasonSelectionReady,
    seasons,
  ]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    onClose();
  };
  const monitoringPatch = (): MonitorMediaPatch => {
    const body: MonitorMediaPatch = { monitorPolicy: policy };
    if (item?.kind !== "series") return body;
    if (policy === "selected") body.seasonNumbers = selectedSeasons;
    body.includeFutureSeasons = includeFutureSeasons;
    return body;
  };
  const itemId = (): string => {
    if (!item) throw new Error(messages.library.selectItemFirst);
    return item.id;
  };
  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch("updateMonitoring", {
        params: { id: itemId() },
        body: monitoringPatch(),
      }),
    onSuccess: refresh,
  });
  const retryMutation = useMutation({
    mutationFn: () =>
      api.post("retryLibraryItem", { params: { id: itemId() } }),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: () =>
      api.delete("removeLibraryItem", {
        params: { id: itemId() },
        body: {
          deleteLibraryRecord,
          deleteLibraryFiles,
          deleteTorrent,
          deleteDownloadData,
        },
      }),
    onSuccess: refresh,
  });
  let dialogTitle =
    item?.kind === "series"
      ? (item.title ?? messages.library.tvShowDetails)
      : (item?.title ?? messages.library.movieDetails);
  if (manualSearchOpen) {
    const title = item?.title ?? messages.library.titleFallback;
    dialogTitle =
      libraryManualReleaseAction(item) === "replace"
        ? messages.library.chooseReplacementFor({ title })
        : messages.library.findReleaseForTitle({ title });
  }
  if (confirmRemove) dialogTitle = messages.library.removeFromLibraryQuestion;
  let dialogDescription: string | undefined;
  if (item && !manualSearchOpen && !confirmRemove) {
    const year = item.year ? String(item.year) : messages.common.yearUnknown;
    dialogDescription =
      item.kind === "series"
        ? messages.library.yearTvDescription({ year })
        : messages.library.yearMovieDescription({ year });
  }
  let dialogSize: "sm" | "lg" | "xl" = "sm";
  if (manualSearchOpen) dialogSize = "lg";
  if (item?.kind === "series" && !confirmRemove) dialogSize = "xl";
  if (item?.kind === "movie" && !confirmRemove) dialogSize = "lg";
  const beginRemoval = () => {
    setDeleteLibraryRecord(true);
    setConfirmRemove(true);
  };

  return (
    <Dialog
      open={Boolean(item)}
      title={dialogTitle}
      description={dialogDescription}
      onClose={onClose}
      size={dialogSize}
    >
      {confirmRemove ? (
        <div className="stack">
          <p className="muted">{messages.library.chooseWhatToRemove}</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteLibraryRecord}
              onChange={(event) => setDeleteLibraryRecord(event.target.checked)}
            />
            <span>
              <strong>{messages.library.removeTitleFromBobarr}</strong>
              <small>{messages.library.filesStayUnlessDeleted}</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteLibraryFiles}
              onChange={(event) => setDeleteLibraryFiles(event.target.checked)}
            />
            <span>
              <strong>{messages.library.deleteOrganizedFiles}</strong>
              <small>
                {item?.storage && item.storage.fileCount > 0
                  ? messages.library.deletesFilesFrom({
                      files: messages.common.files({
                        count: item.storage.fileCount,
                      }),
                      size:
                        item.storage.totalBytes > 0
                          ? messages.library.sizeInParens({
                              size: formatBytes(item.storage.totalBytes),
                            })
                          : "",
                      folder:
                        item.kind === "movie"
                          ? messages.library.moviesFolder
                          : messages.library.televisionFolder,
                    })
                  : messages.library.removesFilesFromFolder}
              </small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteTorrent}
              onChange={(event) => {
                setDeleteTorrent(event.target.checked);
                if (!event.target.checked) setDeleteDownloadData(false);
              }}
            />
            <span>
              <strong>{messages.library.removeTorrent}</strong>
              <small>{messages.library.removeTorrentHint}</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteDownloadData}
              disabled={!deleteTorrent}
              onChange={(event) => setDeleteDownloadData(event.target.checked)}
            />
            <span>
              <strong>{messages.library.deleteOriginalData}</strong>
              <small>{messages.library.cannotBeUndone}</small>
            </span>
          </label>
          {deleteLibraryRecord && deleteLibraryFiles ? (
            <div className="notice notice--warning" role="note">
              {messages.library.willRemoveTitleAndFiles}
            </div>
          ) : null}
          {!deleteLibraryRecord ? (
            <p className="muted">{messages.library.remainsUnmonitored}</p>
          ) : null}
          {removeMutation.isError ? (
            <div className="notice notice--error">
              {removeMutation.error.message}
            </div>
          ) : null}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmRemove(false)}
            >
              {messages.common.back}
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={removeMutation.isPending}
              disabled={
                !deleteLibraryRecord &&
                !deleteLibraryFiles &&
                !deleteTorrent &&
                !deleteDownloadData &&
                item?.monitorPolicy === "none"
              }
              onClick={() => removeMutation.mutate()}
            >
              <Trash2 size={16} /> {messages.library.confirmRemoval}
            </Button>
          </div>
        </div>
      ) : null}
      {!confirmRemove && manualSearchOpen && item ? (
        <LibraryManualReleaseSearch
          item={item}
          seasons={seasons}
          seasonsLoading={seasonQuery.isLoading}
          seasonsError={seasonQuery.error}
          initialSeason={manualSearchTarget?.season}
          initialEpisode={manualSearchTarget?.episode}
          onRetrySeasons={() => void seasonQuery.refetch()}
          onBack={() => {
            setManualSearchOpen(false);
            setManualSearchTarget(undefined);
          }}
        />
      ) : null}
      {!confirmRemove && !manualSearchOpen && item?.kind === "series" ? (
        <TvSeriesManagement
          item={item}
          canMutate={canMutate}
          downloadFiles={downloadFiles}
          seasons={seasons}
          seasonsLoading={seasonQuery.isLoading}
          seasonsError={seasonQuery.error}
          policy={policy}
          selectedSeasons={selectedSeasons}
          includeFutureSeasons={includeFutureSeasons}
          saveBusy={updateMutation.isPending}
          saveError={updateMutation.error?.message}
          onPolicyChange={setPolicy}
          onSelectedSeasonsChange={setSelectedSeasons}
          onIncludeFutureSeasonsChange={setIncludeFutureSeasons}
          onRetrySeasons={() => void seasonQuery.refetch()}
          onSave={() => updateMutation.mutate()}
          onManualSearch={(target) => {
            setManualSearchTarget(target);
            setManualSearchOpen(true);
          }}
          onRemove={beginRemoval}
        />
      ) : null}
      {!confirmRemove && !manualSearchOpen && item?.kind === "movie" ? (
        <MovieManagement
          item={item}
          canMutate={canMutate}
          actors={movieDetailsQuery.data?.actors}
          actorsLoading={
            isPositiveSafeInteger(item.tmdbId) && movieDetailsQuery.isLoading
          }
          trailer={movieDetailsQuery.data?.trailer}
          downloadFiles={downloadFiles}
          policy={policy}
          saveBusy={updateMutation.isPending}
          saveError={updateMutation.error?.message}
          retryBusy={retryMutation.isPending}
          retryError={retryMutation.error?.message}
          onPolicyChange={setPolicy}
          onSave={() => updateMutation.mutate()}
          onRetry={() => retryMutation.mutate()}
          onManualSearch={() => {
            setManualSearchTarget(undefined);
            setManualSearchOpen(true);
          }}
          onActorSelect={(actor) => {
            onClose();
            navigate(actorDiscoverPath(actor));
          }}
          onBrowseSimilar={() => {
            const genreId = item.genres?.[0]?.id;
            onClose();
            if (genreId) {
              navigate(`/discover?kind=movie&genres=${genreId}&hideOwned=1`);
              return;
            }
            navigate("/suggestions");
          }}
          onRemove={beginRemoval}
        />
      ) : null}
    </Dialog>
  );
}

export function LibraryPage({ kind }: { kind: "movie" | "series" }) {
  const { messages } = useUi();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const canManageSettings =
    sessionQuery.data?.capabilities?.canManageSettings === true;
  const [searchParams, setSearchParams] = useSearchParams();
  const routeBrowse = libraryBrowseFromSearchParams(searchParams);
  const [browse, setBrowse] = useState<LibraryBrowseFilters>(() => ({
    ...createDefaultLibraryBrowseFilters(),
    ...routeBrowse,
  }));
  const [search, setSearch] = useState(routeBrowse.search ?? "");
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const dismissedItemIdRef = useRef<string | undefined>(undefined);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const normalizedSearch = search.trim();
  const availability = libraryAvailabilityParam(browse.filter);
  const ratingMin = optionalBrowseNumber(browse.ratingMin);
  const year = optionalBrowseNumber(browse.year);
  const libraryQuery = useInfiniteQuery({
    queryKey: [
      "library",
      kind,
      normalizedSearch,
      browse.filter,
      browse.sort,
      browse.genreId,
      browse.year,
      browse.ratingMin,
      browse.quality,
    ],
    queryFn: ({ pageParam, signal }) =>
      api.get("listLibrary", {
        query: {
          kind,
          limit: LIBRARY_PAGE_SIZE,
          offset: pageParam,
          sort: browse.sort,
          ...(normalizedSearch === "" ? {} : { search: normalizedSearch }),
          ...(availability === undefined ? {} : { availability }),
          ...(browse.genreId === null ? {} : { genreId: browse.genreId }),
          ...(year === undefined ? {} : { year }),
          ...(ratingMin === undefined ? {} : { ratingMin }),
          ...(browse.quality === "" ? {} : { quality: browse.quality }),
        },
        signal,
      }),
    placeholderData: (previousData, previousQuery) =>
      libraryPlaceholderData(previousData, previousQuery?.queryKey[1], kind),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.page.offset + lastPage.items.length;
      return nextOffset < lastPage.page.total ? nextOffset : undefined;
    },
  });
  const genresQuery = useQuery({
    queryKey: ["catalog", "genres", kind],
    queryFn: ({ signal }) =>
      api.get("catalogGenres", { query: { kind }, signal }),
    staleTime: 24 * 60 * 60_000,
  });
  const scanMutation = useMutation({
    mutationFn: () => api.post("scanLibrary", { body: { kind } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const items = useMemo(
    () =>
      libraryQuery.data?.pages.flatMap((page) => collectionItems(page)) ?? [],
    [libraryQuery.data],
  );
  const summary = libraryQuery.data?.pages[0]?.summary;
  const isMovies = kind === "movie";
  const browsingDefault = libraryBrowseIsDefault(browse, search);
  const focusItemId = routeBrowse.itemId;

  useEffect(() => {
    setSearchParams(
      (previous) =>
        writeLibraryBrowseSearchParams(
          previous,
          browse,
          search,
          previous.get("item"),
        ),
      { replace: true },
    );
  }, [browse, search, setSearchParams]);

  const focusedItemQuery = useQuery({
    queryKey: ["library", "item", focusItemId],
    queryFn: async ({ signal }) => {
      const item = await api.get("getLibraryItem", {
        params: { id: focusItemId! },
        signal,
      });
      return collectionItems({ items: [item] })[0]!;
    },
    enabled: Boolean(focusItemId) && selected?.id !== focusItemId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!focusItemId) {
      dismissedItemIdRef.current = undefined;
      return;
    }
    if (dismissedItemIdRef.current !== focusItemId) {
      dismissedItemIdRef.current = undefined;
    }
    if (
      dismissedItemIdRef.current === focusItemId ||
      selected?.id === focusItemId
    ) {
      return;
    }
    const match =
      items.find((item) => item.id === focusItemId) ?? focusedItemQuery.data;
    if (match) setSelected(match);
  }, [focusItemId, focusedItemQuery.data, items, selected?.id]);

  function openLibraryItem(item: LibraryItem): void {
    dismissedItemIdRef.current = undefined;
    setSelected(item);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("item", item.id);
        return next;
      },
      { replace: true },
    );
  }

  function closeLibraryItem(): void {
    dismissedItemIdRef.current = selected?.id;
    setSelected(null);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("item");
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !libraryQuery.hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void libraryQuery.fetchNextPage();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [libraryQuery.hasNextPage, libraryQuery.fetchNextPage, items.length]);

  function updateBrowse(patch: Partial<LibraryBrowseFilters>): void {
    setBrowse((current) => ({ ...current, ...patch }));
  }

  return (
    <Page
      eyebrow={messages.library.eyebrow}
      title={isMovies ? messages.nav.movies : messages.nav.shows}
      description={
        isMovies
          ? messages.library.moviesDescription
          : messages.library.showsDescription
      }
      actions={
        canManageSettings ? (
          <Button
            type="button"
            variant="secondary"
            busy={scanMutation.isPending}
            onClick={() => scanMutation.mutate()}
          >
            <ScanSearch size={17} /> {messages.library.scan}
          </Button>
        ) : undefined
      }
      wide
    >
      <div className="library-switcher" aria-label={messages.library.type}>
        <Link className={isMovies ? "is-active" : ""} to="/library/movies">
          <Film size={17} /> {messages.nav.movies}
        </Link>
        <Link className={!isMovies ? "is-active" : ""} to="/library/shows">
          <Tv size={17} /> {messages.nav.shows}
        </Link>
      </div>
      {summary ? (
        <LibrarySummary
          summary={summary}
          filter={browse.filter}
          onFilterChange={(filter) => updateBrowse({ filter })}
        />
      ) : null}
      {summary && libraryNeedsAttentionCount(summary) > 0 ? (
        <LibraryAttentionStrip
          missing={summary.missing}
          failed={summary.failed}
          onShowMissing={() => updateBrowse({ filter: "missing" })}
          onShowFailed={() => updateBrowse({ filter: "failed" })}
        />
      ) : null}
      {canManageSettings ? <ScanReviewPanel kind={kind} /> : null}
      {browsingDefault && (summary?.total ?? 0) > 0 ? (
        <MediaLibraryShelves kind={kind} enabled onSelect={openLibraryItem} />
      ) : null}
      <div className="library-toolbar">
        <div className="mini-search">
          <Search size={17} />
          <input
            aria-label={
              isMovies
                ? messages.library.filterMovies
                : messages.library.filterShows
            }
            placeholder={messages.library.filterPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <SegmentedControl
          label={messages.library.availability}
          value={browse.filter}
          options={[
            { value: "all", label: messages.library.all },
            { value: "available", label: messages.library.available },
            { value: "missing", label: messages.library.missing },
            { value: "active", label: messages.library.active },
            { value: "failed", label: messages.library.failed },
          ]}
          onChange={(filter) => updateBrowse({ filter })}
        />
      </div>
      <div
        className="library-browse-filters"
        aria-label={messages.library.browseFilters}
      >
        <SelectField
          label={messages.library.sort}
          value={browse.sort}
          onChange={(event) =>
            updateBrowse({
              sort: event.target.value as LibraryBrowseFilters["sort"],
            })
          }
        >
          {LIBRARY_SORT_OPTIONS.map((sort) => (
            <option key={sort} value={sort}>
              {librarySortLabel(sort, messages)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={messages.library.genre}
          value={browse.genreId ?? ""}
          onChange={(event) =>
            updateBrowse({
              genreId: event.target.value ? Number(event.target.value) : null,
            })
          }
        >
          <option value="">{messages.library.anyGenre}</option>
          {(genresQuery.data?.items ?? []).map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={messages.library.year}
          value={browse.year}
          onChange={(event) => updateBrowse({ year: event.target.value })}
        >
          <option value="">{messages.library.anyYear}</option>
          {Array.from({ length: 30 }, (_, index) => 2026 - index).map(
            (value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ),
          )}
        </SelectField>
        <SelectField
          label={messages.library.rating}
          value={browse.ratingMin}
          onChange={(event) => updateBrowse({ ratingMin: event.target.value })}
        >
          {LIBRARY_RATING_OPTIONS.map((value) => (
            <option key={value || "any"} value={value}>
              {libraryRatingLabel(value, messages)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={messages.library.quality}
          value={browse.quality}
          onChange={(event) => updateBrowse({ quality: event.target.value })}
        >
          {LIBRARY_QUALITY_OPTIONS.map((value) => (
            <option key={value || "any"} value={value}>
              {libraryQualityLabel(value, messages)}
            </option>
          ))}
        </SelectField>
        {!browsingDefault ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setBrowse(createDefaultLibraryBrowseFilters());
              setSearch("");
            }}
          >
            {messages.library.clearFilters}
          </Button>
        ) : null}
      </div>
      {scanMutation.isSuccess ? (
        <div className="notice notice--success" role="status">
          <ScanSearch size={17} />
          {messages.library.scanQueued}
        </div>
      ) : null}
      {scanMutation.isError ? (
        <div className="notice notice--error" role="alert">
          {scanMutation.error.message}
        </div>
      ) : null}
      {libraryQuery.isLoading ? <SkeletonGrid count={8} /> : null}
      {libraryQuery.isError ? (
        <ErrorState
          error={libraryQuery.error}
          onRetry={() => void libraryQuery.refetch()}
        />
      ) : null}
      {libraryQuery.data && items.length === 0 && browsingDefault ? (
        <LibraryEmptyGuidance
          kind={kind}
          onScan={() => scanMutation.mutate()}
          scanBusy={scanMutation.isPending}
        />
      ) : null}
      {libraryQuery.data && items.length === 0 && !browsingDefault ? (
        <EmptyState
          title={messages.library.noMatchingTitles}
          description={messages.library.changeFilters}
        />
      ) : null}
      {items.length ? (
        <>
          <div className="library-grid" aria-label={messages.library.grid}>
            {items.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                onGenreSelect={(genreId) => updateBrowse({ genreId })}
                onManage={openLibraryItem}
              />
            ))}
          </div>
          <div ref={loadMoreRef} className="load-more-row">
            {libraryQuery.hasNextPage ? (
              <Button
                type="button"
                variant="secondary"
                busy={libraryQuery.isFetchingNextPage}
                onClick={() => void libraryQuery.fetchNextPage()}
              >
                {libraryQuery.isFetchingNextPage
                  ? messages.common.loadingEllipsis
                  : messages.common.loadMore}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      <ManageLibraryDialog
        key={selected?.id}
        item={selected}
        onClose={closeLibraryItem}
      />
    </Page>
  );
}
