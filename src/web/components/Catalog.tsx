import type { CatalogItem } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Calendar, Check, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";

import { ReleaseSearchPanel } from "./ReleaseSearchPanel";
import { Badge, Button, Dialog, InlineSpinner, SelectField } from "./ui";
import { api } from "../api/client";
import { formatDate, imageUrl, initials, mediaYear } from "../lib/format";

function stateTone(
  state?: string,
): "neutral" | "accent" | "success" | "warning" | "danger" | "info" {
  if (state === "available" || state === "completed") return "success";
  if (state === "failed" || state === "missing") return "danger";
  if (state === "downloading" || state === "organizing") return "info";
  if (state === "searching" || state === "queued") return "warning";
  return "neutral";
}

export function MediaCard({
  item,
  onSelect,
}: {
  item: CatalogItem;
  onSelect: (item: CatalogItem) => void;
}) {
  const poster = imageUrl(item.posterPath, "w500");
  return (
    <article className="media-card">
      <button
        type="button"
        className="media-card__button"
        aria-label={`View ${item.title}`}
        onClick={() => onSelect(item)}
      >
        <span className="media-card__artwork">
          {poster ? (
            <img src={poster} alt="" loading="lazy" />
          ) : (
            <span className="poster-placeholder" aria-hidden="true">
              {initials(item.title)}
            </span>
          )}
          <span className="media-card__scrim" />
          {item.voteAverage ? (
            <span className="rating-pill">
              <Star size={12} fill="currentColor" />
              {item.voteAverage.toFixed(1)}
            </span>
          ) : null}
          {item.monitored ? (
            <span className="monitored-pill">
              <Check size={13} />
              Tracked
            </span>
          ) : null}
        </span>
        <span className="media-card__copy">
          <strong>{item.title}</strong>
          <span>
            {mediaYear(item)} · {item.kind === "movie" ? "Movie" : "Series"}
          </span>
        </span>
      </button>
    </article>
  );
}

export function MediaGrid({
  items,
  onSelect,
}: {
  items: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
}) {
  return (
    <div className="poster-grid">
      {items.map((item) => (
        <MediaCard
          item={item}
          key={`${item.kind}-${item.id}`}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function ExternalRatings({
  ratings,
}: {
  ratings: CatalogItem["ratings"];
}) {
  if (!ratings?.imdb && !ratings?.rottenTomatoes) return null;
  return (
    <dl className="external-ratings" aria-label="External ratings">
      {ratings.imdb ? (
        <div className="external-rating external-rating--imdb">
          <dt>IMDb</dt>
          <dd
            aria-label={`IMDb rating ${ratings.imdb.value} out of ${ratings.imdb.scale}`}
          >
            {ratings.imdb.value.toFixed(1)}
            <span aria-hidden="true">/{ratings.imdb.scale}</span>
          </dd>
        </div>
      ) : null}
      {ratings.rottenTomatoes ? (
        <div className="external-rating external-rating--tomatoes">
          <dt>Rotten Tomatoes</dt>
          <dd
            aria-label={`Rotten Tomatoes rating ${ratings.rottenTomatoes.value} percent`}
          >
            {Math.round(ratings.rottenTomatoes.value)}%
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function MediaDetailDialog({
  selected,
  onClose,
}: {
  selected: CatalogItem | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [showReleases, setShowReleases] = useState(false);
  const [message, setMessage] = useState<string>();
  const [selectedSeason, setSelectedSeason] = useState<number>();
  const [seasonSelection, setSeasonSelection] = useState<number[]>([]);
  const [seasonSelectionReady, setSeasonSelectionReady] = useState(false);
  const [includeFutureSeasons, setIncludeFutureSeasons] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["catalog", "detail", selected?.kind, selected?.tmdbId],
    queryFn: ({ signal }) => {
      if (!selected) throw new Error("Select a catalog title first.");
      return api.get("catalogDetails", {
        params: { kind: selected.kind, tmdbId: selected.tmdbId },
        signal,
      });
    },
    enabled: Boolean(selected),
    placeholderData: selected ?? undefined,
  });

  const monitorMutation = useMutation({
    mutationFn: (item: CatalogItem) =>
      api.post("monitorMedia", {
        body:
          item.kind === "movie"
            ? {
                tmdbId: item.tmdbId,
                kind: item.kind,
                monitorPolicy: "all",
              }
            : {
                tmdbId: item.tmdbId,
                kind: item.kind,
                monitorPolicy: "selected",
                seasonNumbers: seasonSelection,
                includeFutureSeasons,
              },
      }),
    onSuccess: () => {
      if (seasonSelection.length > 0) {
        setSelectedSeason(Math.max(...seasonSelection));
      }
      setMessage(
        "Added to your library. Bobarr will look for an eligible release.",
      );
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  useEffect(() => {
    setSelectedSeason(undefined);
    setSeasonSelection([]);
    setSeasonSelectionReady(false);
    setIncludeFutureSeasons(false);
    setShowReleases(false);
    setMessage(undefined);
  }, [selected?.kind, selected?.tmdbId]);

  useEffect(() => {
    const seasonCount = detailQuery.data?.numberOfSeasons ?? 0;
    if (
      seasonSelectionReady ||
      detailQuery.data?.kind !== "series" ||
      seasonCount < 1
    ) {
      return;
    }
    setSeasonSelection([seasonCount]);
    setSeasonSelectionReady(true);
  }, [detailQuery.data, seasonSelectionReady]);

  useEffect(() => {
    const seasonCount = detailQuery.data?.numberOfSeasons;
    const monitoredSeasons = detailQuery.data?.monitoredSeasonNumbers;
    const latestMonitoredSeason = monitoredSeasons?.length
      ? Math.max(...monitoredSeasons)
      : undefined;
    if (
      selectedSeason === undefined &&
      detailQuery.data?.kind === "series" &&
      (latestMonitoredSeason !== undefined ||
        (seasonCount !== null && seasonCount !== undefined && seasonCount > 0))
    ) {
      setSelectedSeason(latestMonitoredSeason ?? seasonCount ?? undefined);
    }
  }, [detailQuery.data, selectedSeason]);

  const item = detailQuery.data ?? selected;
  const backdrop = imageUrl(item?.backdropPath, "original");
  const canManualSearch = Boolean(item?.monitored || monitorMutation.isSuccess);
  let selectableSeasons = item?.monitoredSeasonNumbers?.length
    ? item.monitoredSeasonNumbers
    : Array.from(
        { length: item?.numberOfSeasons ?? 0 },
        (_, index) => index + 1,
      );
  if (
    !item?.monitoredSeasonNumbers?.length &&
    monitorMutation.isSuccess &&
    seasonSelection.length > 0
  ) {
    selectableSeasons = seasonSelection;
  }
  const hasManualSeasonPicker =
    item?.kind === "series" && (item.numberOfSeasons ?? 0) > 0;
  const manualSearchButton = (
    <Button
      type="button"
      variant="secondary"
      disabled={!canManualSearch}
      title={
        canManualSearch
          ? undefined
          : "Add this title to your library before searching releases"
      }
      onClick={() => setShowReleases((value) => !value)}
    >
      <Search size={17} /> {showReleases ? "Hide releases" : "Manual search"}
    </Button>
  );

  return (
    <Dialog
      open={Boolean(selected)}
      title={item?.title ?? "Title details"}
      description={
        item
          ? `${mediaYear(item)} · ${item.kind === "movie" ? "Movie" : "Series"}`
          : undefined
      }
      onClose={() => {
        setShowReleases(false);
        setMessage(undefined);
        onClose();
      }}
      size="lg"
    >
      {item ? (
        <div className="media-detail">
          <div
            className="media-detail__hero"
            style={
              backdrop ? { backgroundImage: `url(${backdrop})` } : undefined
            }
          >
            <div className="media-detail__hero-scrim" />
            <div className="media-detail__summary">
              <div className="media-detail__badges">
                <Badge tone="accent">
                  {item.kind === "movie" ? "Movie" : "Series"}
                </Badge>
                {item.voteAverage ? (
                  <Badge>
                    <Star size={12} fill="currentColor" />{" "}
                    {item.voteAverage.toFixed(1)}
                  </Badge>
                ) : null}
                {item.acquisitionState ? (
                  <Badge tone={stateTone(item.acquisitionState)}>
                    {item.acquisitionState}
                  </Badge>
                ) : null}
              </div>
              <ExternalRatings ratings={item.ratings} />
              <p>{item.overview || "No synopsis is available yet."}</p>
              {item.genres?.length ? (
                <p className="media-detail__genres">
                  {item.genres.map((genre) => genre.name).join(" · ")}
                </p>
              ) : null}
            </div>
          </div>

          {message ? (
            <div className="notice notice--success" role="status">
              <Check size={17} />
              {message}
            </div>
          ) : null}
          {monitorMutation.isError ? (
            <div className="notice notice--error" role="alert">
              {monitorMutation.error.message}
            </div>
          ) : null}
          {item.kind === "series" &&
          !item.monitored &&
          !monitorMutation.isSuccess &&
          (item.numberOfSeasons ?? 0) > 0 ? (
            <section
              className="season-monitor"
              aria-labelledby="season-monitor-title"
            >
              <div className="season-monitor__heading">
                <div>
                  <h3 id="season-monitor-title">Choose seasons</h3>
                  <p>Only selected seasons are searched automatically.</p>
                </div>
                <div className="season-monitor__shortcuts">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSeasonSelection(
                        Array.from(
                          { length: item.numberOfSeasons ?? 0 },
                          (_, index) => index + 1,
                        ),
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSeasonSelection([item.numberOfSeasons ?? 1])
                    }
                  >
                    Latest
                  </Button>
                </div>
              </div>
              <div className="season-monitor__grid">
                {Array.from(
                  { length: item.numberOfSeasons ?? 0 },
                  (_, index) => index + 1,
                ).map((season) => (
                  <label className="season-choice" key={season}>
                    <input
                      type="checkbox"
                      checked={seasonSelection.includes(season)}
                      onChange={(event) =>
                        setSeasonSelection((current) =>
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
                    Opt in to newly announced seasons during metadata refresh.
                  </small>
                </span>
              </label>
            </section>
          ) : null}

          <div className="media-detail__actions">
            <Button
              type="button"
              busy={monitorMutation.isPending}
              disabled={
                Boolean(item.monitored) ||
                (item.kind === "series" &&
                  (item.numberOfSeasons ?? 0) > 0 &&
                  seasonSelection.length === 0)
              }
              onClick={() => monitorMutation.mutate(item)}
            >
              {item.monitored ? (
                <Check size={17} />
              ) : (
                <BookmarkPlus size={17} />
              )}
              {item.monitored ? "In library" : "Add to library"}
            </Button>
            {!hasManualSeasonPicker ? manualSearchButton : null}
          </div>

          {!canManualSearch ? (
            <p className="field__hint" role="note">
              Add this title to your library before searching or grabbing a
              release.
            </p>
          ) : null}

          {hasManualSeasonPicker ? (
            <div className="media-detail__manual-search">
              <div className="media-detail__manual-search-controls">
                <SelectField
                  label="Season for manual search"
                  value={selectedSeason ?? ""}
                  onChange={(event) =>
                    setSelectedSeason(Number(event.currentTarget.value))
                  }
                >
                  {selectableSeasons.map((season) => (
                    <option value={season} key={season}>
                      Season {season}
                    </option>
                  ))}
                </SelectField>
                {manualSearchButton}
              </div>
              <p className="field__hint">
                Bobarr attaches the selected release to this monitored season.
              </p>
            </div>
          ) : null}

          {showReleases ? (
            <ReleaseSearchPanel
              key={`${item.kind}:${item.tmdbId}:${selectedSeason ?? "title"}`}
              target={{
                tmdbId: item.tmdbId,
                kind: item.kind,
                ...(item.kind === "series" && selectedSeason !== undefined
                  ? { season: selectedSeason }
                  : {}),
              }}
              onQueued={() => setMessage(undefined)}
            />
          ) : null}
        </div>
      ) : null}
      {!item && detailQuery.isLoading ? <InlineSpinner /> : null}
    </Dialog>
  );
}

export function CalendarMeta({ date }: { date?: string | null }) {
  if (!date) return null;
  return (
    <span className="icon-meta">
      <Calendar size={14} aria-hidden="true" />
      {formatDate(date)}
    </span>
  );
}
