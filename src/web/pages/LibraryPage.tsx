import type { MonitorMediaPatch } from "../../contracts/api-routes";
import type { AcquisitionState, LibraryItem, MonitorPolicy } from "../types";

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
  Film,
  FolderOpen,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  Star,
  Trash2,
  Tv,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { api } from "../api/client";
import { collectionItems } from "../api/normalize";
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
  SelectField,
  SkeletonGrid,
} from "../components/ui";
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

type LibraryFilter = "all" | "available" | "missing" | "active" | "failed";
type ManualReleaseAction = "search" | "replace";
const LIBRARY_PAGE_SIZE = 50;

export function LibrarySummary({
  summary,
}: {
  summary: {
    total: number;
    downloaded: number;
    active: number;
    missing: number;
    failed: number;
  };
}) {
  return (
    <dl className="library-summary" aria-label="Library summary">
      <div>
        <dt>Downloaded</dt>
        <dd>{summary.downloaded}</dd>
      </div>
      <div>
        <dt>Active</dt>
        <dd>{summary.active}</dd>
      </div>
      <div>
        <dt>Missing</dt>
        <dd>{summary.missing}</dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd>{summary.total}</dd>
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

function isFilterMatch(item: LibraryItem, filter: LibraryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active")
    return ["searching", "queued", "downloading", "organizing"].includes(
      item.acquisitionState,
    );
  return item.acquisitionState === filter;
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

function downloadStateLabel(state: string): string {
  return `${state.slice(0, 1).toUpperCase()}${state.slice(1)}`;
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

export function canManuallySearchLibraryItem(
  item: LibraryItem | null,
): boolean {
  return (
    item !== null &&
    item.monitorPolicy !== "none" &&
    isPositiveSafeInteger(item.tmdbId)
  );
}

export function libraryManualReleaseAction(
  item: LibraryItem | null,
): ManualReleaseAction | null {
  if (
    item?.acquisitionState === "available" &&
    isPositiveSafeInteger(item.tmdbId)
  ) {
    return "replace";
  }
  return canManuallySearchLibraryItem(item) ? "search" : null;
}

export function LibraryCard({
  item,
  onManage,
}: {
  item: LibraryItem;
  onManage: (item: LibraryItem) => void;
}) {
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
  let locationLabel = "Download folder";
  if (activeDownload && activeDownloadPath) locationLabel = "Downloading to";
  else if (storage?.libraryPath) locationLabel = "In library";
  const storageDetails = [
    storage?.quality ?? undefined,
    storage && storage.fileCount > 0
      ? `${storage.fileCount} ${storage.fileCount === 1 ? "file" : "files"}`
      : undefined,
    storage && storage.totalBytes > 0
      ? formatBytes(storage.totalBytes)
      : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  const visibleGenres = item.genres?.slice(0, 2) ?? [];
  const remainingGenres = Math.max(0, (item.genres?.length ?? 0) - 2);
  const cardTitle = locationPath
    ? `${item.title} · ${locationLabel}: ${locationPath}`
    : `Open ${item.title} details`;
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
              {mediaYear(item)} · {item.kind === "movie" ? "Movie" : "Series"}
            </p>
          </div>
          {rating && rating.value > 0 ? (
            <span
              className="library-card__rating"
              aria-label={`${rating.source.toUpperCase()} rating ${rating.value.toFixed(1)} out of 10${
                rating.votes === null
                  ? ""
                  : `, ${rating.votes.toLocaleString()} votes`
              }`}
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
            {item.acquisitionState}
          </Badge>
          {visibleGenres.length > 0 ? (
            <span className="library-card__genres" aria-label="Genres">
              {visibleGenres.map((genre) => (
                <span key={genre.id}>{genre.name}</span>
              ))}
              {remainingGenres > 0 ? <span>+{remainingGenres}</span> : null}
            </span>
          ) : null}
        </div>

        {activeDownload && downloadPercent !== undefined ? (
          <div className="library-card__download">
            <div className="library-card__progress-heading">
              <span>
                <ArrowDown size={13} aria-hidden="true" />
                {downloadStateLabel(activeDownload.state)}
              </span>
              <strong>{downloadPercent}%</strong>
            </div>
            <ProgressBar
              value={downloadPercent}
              label={`${item.title} download progress`}
            />
            <div className="library-card__download-stats">
              {activeDownload.totalBytes > 0 ? (
                <span>
                  {formatBytes(activeDownload.downloadedBytes)} of{" "}
                  {formatBytes(activeDownload.totalBytes)}
                </span>
              ) : null}
              {activeDownload.downloadRate > 0 ? (
                <span>{formatRate(activeDownload.downloadRate)}</span>
              ) : null}
              {activeDownload.etaSeconds !== null ? (
                <span>ETA {formatEta(activeDownload.etaSeconds)}</span>
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
                {episodeProgress?.available} of {episodeProgress?.total}{" "}
                episodes ready
              </span>
              <strong>{episodePercent}%</strong>
            </div>
            {!activeDownload ? (
              <ProgressBar
                value={episodePercent}
                label={`${item.title} episode availability`}
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
            Next episode {formatDate(nextAirDate)}
          </p>
        ) : null}

        {!activeDownload && item.acquisitionState === "missing" ? (
          <p className="library-card__helper">
            <Search size={13} aria-hidden="true" />
            No file yet · Open to find a release
          </p>
        ) : null}
        {!activeDownload && item.acquisitionState === "failed" ? (
          <p className="library-card__helper library-card__helper--danger">
            <CircleAlert size={13} aria-hidden="true" />
            Acquisition needs attention · Open to retry
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="library-card__hit-area"
        aria-label={`Open ${item.title} details`}
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
  onRetrySeasons,
  onBack,
}: {
  item: LibraryItem;
  seasons: LibraryItem[];
  seasonsLoading: boolean;
  seasonsError: Error | null;
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
  const [selectedSeason, setSelectedSeason] = useState<number>();
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);

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
  const target = libraryReleaseTarget(item, selectedSeason, selectedEpisode);
  const hasValidTmdbId = isPositiveSafeInteger(item.tmdbId);

  return (
    <div className="stack">
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Back to management
        </Button>
        <p className="muted">
          Search Jackett and choose an eligible release. Tracker links and
          credentials stay on the server; the browser receives only a
          short-lived candidate ID.
        </p>
      </div>

      {item.kind === "series" && seasonsLoading ? (
        <InlineSpinner label="Loading monitored seasons…" />
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
            label="Season"
            hint="Search a full season pack or narrow the search to an episode."
            value={selectedSeason ?? ""}
            onChange={(event) => {
              setSelectedSeason(Number(event.currentTarget.value));
              setSelectedEpisode(null);
            }}
          >
            {monitoredSeasons.map((season) => (
              <option value={season.seasonNumber ?? ""} key={season.id}>
                Season {season.seasonNumber}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Release target"
            hint="Missing, failed, queued, and downloading episodes are listed individually."
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
            <option value="season">Entire season pack</option>
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
          title="No monitored seasons"
          description="Return to management and select at least one season before searching releases."
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
          Bobarr cannot search this item because it does not have a valid TMDB
          match.
        </div>
      ) : null}
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
  const queryClient = useQueryClient();
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
  const [deleteLibraryFiles, setDeleteLibraryFiles] = useState(false);
  const [deleteTorrent, setDeleteTorrent] = useState(false);
  const [deleteDownloadData, setDeleteDownloadData] = useState(false);
  const seasonCount =
    typeof item?.metadata?.["numberOfSeasons"] === "number"
      ? item.metadata["numberOfSeasons"]
      : 0;
  const seasonQuery = useQuery({
    queryKey: ["library", "seasons", item?.id],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: { parentId: item?.id, limit: 100 },
        signal,
      }),
    enabled: item?.kind === "series",
  });
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
    if (seasonSelectionReady || !seasonQuery.isSuccess) return;
    setSelectedSeasons(
      seasons.flatMap((season) =>
        season.monitorPolicy !== "none" && season.seasonNumber
          ? [season.seasonNumber]
          : [],
      ),
    );
    setSeasonSelectionReady(true);
  }, [seasonQuery.isSuccess, seasonSelectionReady, seasons]);

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
    if (!item) throw new Error("Select a library item first.");
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
        body: { deleteLibraryFiles, deleteTorrent, deleteDownloadData },
      }),
    onSuccess: refresh,
  });
  const manualReleaseAction = libraryManualReleaseAction(item);
  let dialogTitle = `Manage ${item?.title ?? "title"}`;
  if (manualSearchOpen) {
    dialogTitle =
      manualReleaseAction === "replace"
        ? `Choose a replacement for ${item?.title ?? "title"}`
        : `Find a release for ${item?.title ?? "title"}`;
  }
  if (confirmRemove) dialogTitle = "Remove from library?";

  return (
    <Dialog
      open={Boolean(item)}
      title={dialogTitle}
      onClose={onClose}
      size={manualSearchOpen ? "lg" : "sm"}
    >
      {confirmRemove ? (
        <div className="stack">
          <p className="muted">
            Monitoring stops by default. Choose separately if Bobarr should
            delete any data.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteLibraryFiles}
              onChange={(event) => setDeleteLibraryFiles(event.target.checked)}
            />
            <span>
              <strong>Delete organized library files</strong>
              <small>
                Removes files from your movies or television folder.
              </small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteTorrent}
              onChange={(event) => setDeleteTorrent(event.target.checked)}
            />
            <span>
              <strong>Remove torrent from Transmission</strong>
              <small>Stops seeding and removes its torrent record.</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteDownloadData}
              onChange={(event) => setDeleteDownloadData(event.target.checked)}
            />
            <span>
              <strong>Delete original download data</strong>
              <small>This cannot be undone.</small>
            </span>
          </label>
          {deleteLibraryFiles && deleteTorrent && deleteDownloadData ? (
            <div className="notice notice--warning" role="note">
              All stored data is selected for deletion, so Bobarr will also
              remove this title from the library view.
            </div>
          ) : (
            <p className="muted">
              If any data is kept, the title remains visible as unmonitored so
              you can manage or monitor it again later.
            </p>
          )}
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
              Back
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              <Trash2 size={16} /> Remove
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
          onRetrySeasons={() => void seasonQuery.refetch()}
          onBack={() => setManualSearchOpen(false)}
        />
      ) : null}
      {!confirmRemove && !manualSearchOpen ? (
        <div className="stack">
          <label className="field">
            <span className="field__label">Monitoring policy</span>
            <select
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as MonitorPolicy)
              }
            >
              <option value="none">Do not monitor</option>
              {item?.kind === "series" ? (
                <option value="selected">Selected seasons</option>
              ) : null}
              <option value="all">
                {item?.kind === "series"
                  ? "All current seasons"
                  : "Monitor this movie"}
              </option>
            </select>
            <span className="field__hint">
              Controls what automatic searches can acquire.
            </span>
          </label>
          {item?.kind === "series" && policy !== "none" ? (
            <section className="season-monitor" aria-label="Season monitoring">
              <div className="season-monitor__heading">
                <div>
                  <h3>Monitored seasons</h3>
                  <p>
                    {policy === "all"
                      ? "Every current season will be monitored."
                      : "Choose each season Bobarr may acquire."}
                  </p>
                </div>
              </div>
              {policy === "selected" ? (
                <div className="season-monitor__grid">
                  {Array.from(
                    { length: seasonCount },
                    (_, index) => index + 1,
                  ).map((season) => (
                    <label className="season-choice" key={season}>
                      <input
                        type="checkbox"
                        checked={selectedSeasons.includes(season)}
                        onChange={(event) =>
                          setSelectedSeasons((current) =>
                            event.target.checked
                              ? [...current, season].sort(
                                  (left, right) => left - right,
                                )
                              : current.filter((value) => value !== season),
                          )
                        }
                      />
                      <span>Season {season}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={includeFutureSeasons}
                  onChange={(event) =>
                    setIncludeFutureSeasons(event.target.checked)
                  }
                />
                <span>
                  <strong>Monitor future seasons</strong>
                  <small>
                    Automatically add newly announced seasons after refresh.
                  </small>
                </span>
              </label>
            </section>
          ) : null}
          {updateMutation.isError || retryMutation.isError ? (
            <div className="notice notice--error">
              {updateMutation.error?.message ?? retryMutation.error?.message}
            </div>
          ) : null}
          <Button
            type="button"
            busy={updateMutation.isPending}
            disabled={
              item?.kind === "series" &&
              policy === "selected" &&
              selectedSeasons.length === 0
            }
            onClick={() => updateMutation.mutate()}
          >
            <Check size={16} /> Save monitoring
          </Button>
          <Button
            type="button"
            variant="secondary"
            busy={retryMutation.isPending}
            onClick={() => retryMutation.mutate()}
          >
            <RefreshCw size={16} /> Retry automatic search
          </Button>
          {manualReleaseAction === "search" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setManualSearchOpen(true)}
            >
              <Search size={16} /> Search releases manually…
            </Button>
          ) : null}
          {manualReleaseAction === "replace" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setManualSearchOpen(true)}
            >
              <RefreshCw size={16} /> Replace release
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="danger-text"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 size={16} /> Remove from library…
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}

export function LibraryPage({ kind }: { kind: "movie" | "series" }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const libraryQuery = useInfiniteQuery({
    queryKey: ["library", kind],
    queryFn: ({ pageParam, signal }) =>
      api.get("listLibrary", {
        query: { kind, limit: LIBRARY_PAGE_SIZE, offset: pageParam },
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.page.offset + lastPage.items.length;
      return nextOffset < lastPage.page.total ? nextOffset : undefined;
    },
  });
  const scanMutation = useMutation({
    mutationFn: () => api.post("scanLibrary", { body: { kind } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const items = useMemo(
    () =>
      (
        libraryQuery.data?.pages.flatMap((page) => collectionItems(page)) ?? []
      ).filter(
        (item) =>
          isFilterMatch(item, filter) &&
          item.title
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
      ),
    [filter, libraryQuery.data, search],
  );
  const isMovies = kind === "movie";

  return (
    <Page
      eyebrow="Your library"
      title={isMovies ? "Movies" : "Shows"}
      description={
        isMovies
          ? "Tracked films, downloads, and organized files in one place."
          : "Every monitored season and episode, without the spreadsheet."
      }
      actions={
        <Button
          type="button"
          variant="secondary"
          busy={scanMutation.isPending}
          onClick={() => scanMutation.mutate()}
        >
          <ScanSearch size={17} /> Scan library
        </Button>
      }
      wide
    >
      <div className="library-switcher" aria-label="Library type">
        <Link className={isMovies ? "is-active" : ""} to="/library/movies">
          <Film size={17} /> Movies
        </Link>
        <Link className={!isMovies ? "is-active" : ""} to="/library/shows">
          <Tv size={17} /> Shows
        </Link>
      </div>
      {libraryQuery.data?.pages[0] ? (
        <LibrarySummary summary={libraryQuery.data.pages[0].summary} />
      ) : null}
      <ScanReviewPanel kind={kind} />
      <div className="library-toolbar">
        <div className="mini-search">
          <Search size={17} />
          <input
            aria-label={`Filter ${isMovies ? "movies" : "shows"}`}
            placeholder="Filter your library…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <SegmentedControl
          label="Availability"
          value={filter}
          options={[
            { value: "all", label: "All" },
            { value: "available", label: "Available" },
            { value: "missing", label: "Missing" },
            { value: "active", label: "Active" },
            { value: "failed", label: "Failed" },
          ]}
          onChange={setFilter}
        />
      </div>
      {scanMutation.isSuccess ? (
        <div className="notice notice--success" role="status">
          <ScanSearch size={17} />
          Library scan queued. Follow its progress in Activity.
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
      {libraryQuery.data && items.length === 0 ? (
        <EmptyState
          title={
            search || filter !== "all"
              ? "No matching titles"
              : `No ${isMovies ? "movies" : "shows"} yet`
          }
          description={
            search || filter !== "all"
              ? "Change your filters to see more of your library."
              : "Find a title and add it to start automatic monitoring."
          }
          action={
            !search && filter === "all" ? (
              <Link className="button button--primary button--md" to="/search">
                <Play size={16} /> Find a title
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {items.length ? (
        <>
          <div className="library-grid">
            {items.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                onManage={(next) => {
                  setSelected(next);
                }}
              />
            ))}
          </div>
          {libraryQuery.hasNextPage ? (
            <div className="load-more-row">
              <Button
                type="button"
                variant="secondary"
                busy={libraryQuery.isFetchingNextPage}
                onClick={() => void libraryQuery.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <ManageLibraryDialog
        key={selected?.id}
        item={selected}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}
