import type { CatalogItem, CatalogRecommendationGroup } from "../types";
import type { KeyboardEvent } from "react";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { api } from "../api/client";
import { normalizeCatalogRecommendations } from "../api/normalize";
import { MediaCard, MediaDetailDialog } from "../components/Catalog";
import { Page } from "../components/Page";
import { Button, EmptyState, ErrorState, IconButton } from "../components/ui";
import { imageUrl, initials } from "../lib/format";

export type SuggestionKind = "all" | "movie" | "series";

const suggestionKinds: Array<{ value: SuggestionKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "TV Shows" },
];

export function suggestionGroupsForKind(
  groups: CatalogRecommendationGroup[] | undefined,
  kind: SuggestionKind,
): CatalogRecommendationGroup[] {
  if (!groups) return [];
  if (kind === "all") return groups;
  return groups.filter((group) => group.source.kind === kind);
}

export function suggestionCounts(
  groups: CatalogRecommendationGroup[] | undefined,
): Record<SuggestionKind, number> {
  const groupItems = (kind: Exclude<SuggestionKind, "all">) =>
    suggestionGroupsForKind(groups, kind).reduce(
      (total, group) => total + group.items.length,
      0,
    );
  return {
    all: groups?.reduce((total, group) => total + group.items.length, 0) ?? 0,
    movie: groupItems("movie"),
    series: groupItems("series"),
  };
}

interface SuggestionRailState {
  overflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

export function suggestionRailState({
  clientWidth,
  scrollWidth,
  scrollLeft,
}: {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
}): SuggestionRailState {
  const maximumScroll = Math.max(0, scrollWidth - clientWidth);
  const overflow = maximumScroll > 1;
  return {
    overflow,
    canScrollLeft: overflow && scrollLeft > 1,
    canScrollRight: overflow && scrollLeft < maximumScroll - 1,
  };
}

export function SuggestionKindTabs({
  value,
  counts,
  onChange,
}: {
  value: SuggestionKind;
  counts?: Record<SuggestionKind, number>;
  onChange: (kind: SuggestionKind) => void;
}) {
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>): void {
    const currentIndex = suggestionKinds.findIndex(
      (option) => option.value === value,
    );
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % suggestionKinds.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + suggestionKinds.length) % suggestionKinds.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = suggestionKinds.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = suggestionKinds[nextIndex];
    if (!next) return;
    onChange(next.value);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#suggestions-tab-${next.value}`)
      ?.focus();
  }

  return (
    <div
      className="segmented suggestions-tabs"
      role="tablist"
      aria-label="Suggestion type"
    >
      {suggestionKinds.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            id={`suggestions-tab-${option.value}`}
            type="button"
            role="tab"
            className={active ? "is-active" : undefined}
            aria-selected={active}
            aria-controls={`suggestions-panel-${option.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={moveFocus}
          >
            <span>{option.label}</span>
            {counts ? (
              <>
                <span className="suggestions-tab__count" aria-hidden="true">
                  {counts[option.value]}
                </span>
                <span className="sr-only">
                  {counts[option.value]} suggestion
                  {counts[option.value] === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SuggestionShelf({
  group,
  onSelect,
}: {
  group: CatalogRecommendationGroup;
  onSelect: (item: CatalogItem) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [railState, setRailState] = useState<SuggestionRailState>({
    overflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const source = group.source;
  const sourcePoster = imageUrl(source.posterUrl, "w342");
  const headingId = `suggestion-source-${source.kind}-${source.tmdbId}`;
  const railId = `${headingId}-rail`;
  const sourceKind = source.kind === "movie" ? "Movie" : "TV show";
  const sourceYear = source.year ? String(source.year) : "Year TBA";
  const libraryMix = source.id.startsWith("legacy-library-mix:");

  const updateRailState = useCallback((): void => {
    const rail = railRef.current;
    if (!rail) return;
    const next = suggestionRailState(rail);
    setRailState((current) =>
      current.overflow === next.overflow &&
      current.canScrollLeft === next.canScrollLeft &&
      current.canScrollRight === next.canScrollRight
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    updateRailState();
    rail.addEventListener("scroll", updateRailState, { passive: true });
    const observer = new ResizeObserver(updateRailState);
    observer.observe(rail);
    return () => {
      rail.removeEventListener("scroll", updateRailState);
      observer.disconnect();
    };
  }, [group.items.length, updateRailState]);

  function scrollRail(direction: -1 | 1): void {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({
      left: direction * Math.max(rail.clientWidth * 0.8, 240),
      behavior: "smooth",
    });
  }

  return (
    <section className="suggestion-shelf" aria-labelledby={headingId}>
      <header className="suggestion-shelf__header">
        <div className="suggestion-shelf__source">
          <span className="suggestion-shelf__poster" aria-hidden="true">
            {sourcePoster ? (
              <img src={sourcePoster} alt="" loading="lazy" />
            ) : (
              <span className="poster-placeholder">
                {initials(source.title)}
              </span>
            )}
          </span>
          <div className="suggestion-shelf__copy">
            <span className="eyebrow">
              {libraryMix
                ? "Based on your library"
                : "Inspired by your library"}
            </span>
            <h2 id={headingId}>
              {libraryMix
                ? `More ${source.kind === "movie" ? "movies" : "TV shows"} based on your library`
                : `Because “${source.title}” is in your library`}
            </h2>
            <p>
              {libraryMix ? null : `${sourceYear} · ${sourceKind} · `}
              {group.items.length} suggestion
              {group.items.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {group.items.length > 1 ? (
          <div
            className="suggestion-shelf__controls"
            role="group"
            aria-label={`Scroll suggestions inspired by ${source.title}`}
            hidden={!railState.overflow}
          >
            <IconButton
              type="button"
              label={`Scroll ${source.title} suggestions left`}
              aria-controls={railId}
              disabled={!railState.canScrollLeft}
              onClick={() => scrollRail(-1)}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </IconButton>
            <IconButton
              type="button"
              label={`Scroll ${source.title} suggestions right`}
              aria-controls={railId}
              disabled={!railState.canScrollRight}
              onClick={() => scrollRail(1)}
            >
              <ChevronRight size={20} aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
      </header>
      <div
        ref={railRef}
        id={railId}
        className="suggestion-shelf__rail"
        role="region"
        aria-labelledby={headingId}
        tabIndex={railState.overflow ? 0 : -1}
      >
        {group.items.map((item) => (
          <MediaCard
            item={item}
            key={`${item.kind}-${item.id}`}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function SuggestionShelvesSkeleton() {
  return (
    <div
      className="suggestion-groups"
      role="status"
      aria-label="Loading suggestion shelves"
      aria-busy="true"
    >
      {[0, 1].map((shelf) => (
        <section
          className="suggestion-shelf suggestion-shelf--skeleton"
          aria-hidden="true"
          key={shelf}
        >
          <div className="suggestion-shelf__header">
            <div className="suggestion-shelf__source">
              <span className="skeleton suggestion-shelf__poster" />
              <div className="suggestion-shelf__copy">
                <span className="skeleton skeleton--line-short" />
                <span className="skeleton skeleton--line" />
              </div>
            </div>
          </div>
          <div className="suggestion-shelf__rail">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="media-card media-card--skeleton" key={index}>
                <div className="skeleton media-card__image" />
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--line-short" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function SuggestionsPage() {
  const [kind, setKind] = useState<SuggestionKind>("all");
  const [cursor, setCursor] = useState<number>();
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const suggestionsQuery = useQuery({
    queryKey: ["catalog", "recommendations", "grouped-v2", cursor ?? "start"],
    queryFn: ({ signal }) =>
      api.get("catalogRecommendations", {
        query: cursor === undefined ? {} : { cursor },
        signal,
      }),
    placeholderData: (previousData) => previousData,
    staleTime: 15 * 60_000,
  });
  const result =
    suggestionsQuery.data === undefined
      ? undefined
      : normalizeCatalogRecommendations(suggestionsQuery.data);
  const counts = result ? suggestionCounts(result.groups) : undefined;
  const visibleGroups = suggestionGroupsForKind(result?.groups, kind);

  function changeKind(nextKind: SuggestionKind): void {
    setKind(nextKind);
    setSelected(null);
  }

  function showNextMix(): void {
    const nextCursor = result?.nextCursor;
    if (nextCursor === null || nextCursor === undefined) return;
    setSelected(null);
    setCursor(nextCursor);
  }

  let description =
    "Recommendations organized around the movies and shows you already chose.";
  if (result?.personalized) {
    description =
      "Every shelf starts with a movie or show already in your library.";
  } else if (result && result.sourceTotal === 0) {
    description =
      "Add a few movies or shows and Bobarr will build recommendation shelves around them.";
  }

  return (
    <Page
      eyebrow="From your library"
      title="Suggestions with a reason"
      description={description}
      actions={
        result?.nextCursor !== null && result?.nextCursor !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            busy={suggestionsQuery.isFetching}
            onClick={showNextMix}
          >
            <RefreshCw size={17} aria-hidden="true" /> New mix
          </Button>
        ) : undefined
      }
      wide
    >
      <div className="suggestions-toolbar">
        <SuggestionKindTabs
          value={kind}
          counts={counts}
          onChange={changeKind}
        />
        {counts ? (
          <p className="suggestions-toolbar__summary" aria-live="polite">
            {counts[kind]} suggestion{counts[kind] === 1 ? "" : "s"} from{" "}
            {visibleGroups.length} library title
            {visibleGroups.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
      {suggestionKinds.map((option) => {
        const active = option.value === kind;
        return (
          <section
            key={option.value}
            id={`suggestions-panel-${option.value}`}
            className="suggestions-results"
            role="tabpanel"
            aria-labelledby={`suggestions-tab-${option.value}`}
            tabIndex={0}
            hidden={!active}
          >
            {active && suggestionsQuery.isLoading ? (
              <SuggestionShelvesSkeleton />
            ) : null}
            {active && suggestionsQuery.isError ? (
              <ErrorState
                error={suggestionsQuery.error}
                title="Suggestions could not be loaded"
                onRetry={() => void suggestionsQuery.refetch()}
              />
            ) : null}
            {active && result && result.groups.length === 0 ? (
              <EmptyState
                title={
                  result.sourceTotal === 0
                    ? "Your recommendation shelves are waiting"
                    : "No fresh suggestions in this mix"
                }
                description={
                  result.sourceTotal === 0
                    ? "Add a movie or show to your library and Bobarr will use it as the starting point for new suggestions."
                    : "Explore the catalog for something new, or try another mix when one is available."
                }
                action={
                  <Link
                    className="button button--primary button--md"
                    to="/discover"
                  >
                    Explore titles
                  </Link>
                }
              />
            ) : null}
            {active &&
            result &&
            result.groups.length > 0 &&
            visibleGroups.length === 0 ? (
              <EmptyState
                title={`No ${kind === "movie" ? "movie" : "TV show"} shelves in this mix`}
                description="There are suggestions under another tab, or you can explore the catalog for a different starting point."
                action={
                  <div className="suggestions-empty-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => changeKind("all")}
                    >
                      View all suggestions
                    </Button>
                    <Link
                      className="button button--primary button--md"
                      to="/discover"
                    >
                      Explore titles
                    </Link>
                  </div>
                }
              />
            ) : null}
            {active && visibleGroups.length > 0 ? (
              <div className="suggestion-groups">
                {visibleGroups.map((group) => (
                  <SuggestionShelf
                    group={group}
                    key={`${group.source.kind}-${group.source.tmdbId}`}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      <MediaDetailDialog
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}
