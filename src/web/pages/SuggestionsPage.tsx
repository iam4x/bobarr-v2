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
import { useUi } from "../i18n/ui";
import { imageUrl, initials } from "../lib/format";

export type SuggestionKind = "all" | "movie" | "series";

const suggestionKinds: SuggestionKind[] = ["all", "movie", "series"];

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
  const { messages } = useUi();
  const kinds: Array<{ value: SuggestionKind; label: string }> = [
    { value: "all", label: messages.kind.all },
    { value: "movie", label: messages.nav.movies },
    { value: "series", label: messages.kind.tvShows },
  ];
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>): void {
    const currentIndex = kinds.findIndex((option) => option.value === value);
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % kinds.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + kinds.length) % kinds.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = kinds.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = kinds[nextIndex];
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
      aria-label={messages.suggestions.type}
    >
      {kinds.map((option) => {
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
                  {messages.suggestions.suggestionCount({
                    count: counts[option.value],
                  })}
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
  const { messages } = useUi();
  const sourceKind =
    source.kind === "movie" ? messages.kind.movie : messages.kind.tvShow;
  const sourceYear = source.year
    ? String(source.year)
    : messages.catalog.yearTba;
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
                ? messages.suggestions.basedOnLibrary
                : messages.suggestions.inspiredByLibrary}
            </span>
            <h2 id={headingId}>
              {libraryMix
                ? messages.suggestions.moreBasedOnLibrary({
                    kind:
                      source.kind === "movie"
                        ? messages.library.moviesLabel
                        : messages.kind.tvShows,
                  })
                : messages.suggestions.becauseInLibrary({
                    title: source.title,
                  })}
            </h2>
            <p>
              {libraryMix
                ? null
                : messages.suggestions.sourceMeta({
                    year: sourceYear,
                    kind: sourceKind,
                    count: messages.suggestions.suggestionCount({
                      count: group.items.length,
                    }),
                  })}
              {libraryMix
                ? messages.suggestions.suggestionCount({
                    count: group.items.length,
                  })
                : null}
            </p>
          </div>
        </div>
        {group.items.length > 1 ? (
          <div
            className="suggestion-shelf__controls"
            role="group"
            aria-label={messages.suggestions.scrollInspired({
              title: source.title,
            })}
            hidden={!railState.overflow}
          >
            <IconButton
              type="button"
              label={messages.suggestions.scrollLeft({ title: source.title })}
              aria-controls={railId}
              disabled={!railState.canScrollLeft}
              onClick={() => scrollRail(-1)}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </IconButton>
            <IconButton
              type="button"
              label={messages.suggestions.scrollRight({ title: source.title })}
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
  const { messages } = useUi();
  return (
    <div
      className="suggestion-groups"
      role="status"
      aria-label={messages.suggestions.loadingShelves}
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
  const { messages } = useUi();
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

  let description = messages.suggestions.defaultDescription;
  if (result?.personalized) {
    description = messages.suggestions.personalizedDescription;
  } else if (result && result.sourceTotal === 0) {
    description = messages.suggestions.emptyLibraryDescription;
  }

  return (
    <Page
      eyebrow={messages.suggestions.eyebrow}
      title={messages.suggestions.title}
      description={description}
      actions={
        result?.nextCursor !== null && result?.nextCursor !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            busy={suggestionsQuery.isFetching}
            onClick={showNextMix}
          >
            <RefreshCw size={17} aria-hidden="true" />{" "}
            {messages.suggestions.newMix}
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
            {messages.suggestions.toolbarSummary({
              suggestions: messages.suggestions.suggestionCount({
                count: counts[kind],
              }),
              titles: messages.suggestions.libraryTitleCount({
                count: visibleGroups.length,
              }),
            })}
          </p>
        ) : null}
      </div>
      {suggestionKinds.map((option) => {
        const active = option === kind;
        return (
          <section
            key={option}
            id={`suggestions-panel-${option}`}
            className="suggestions-results"
            role="tabpanel"
            aria-labelledby={`suggestions-tab-${option}`}
            tabIndex={0}
            hidden={!active}
          >
            {active && suggestionsQuery.isLoading ? (
              <SuggestionShelvesSkeleton />
            ) : null}
            {active && suggestionsQuery.isError ? (
              <ErrorState
                error={suggestionsQuery.error}
                title={messages.suggestions.loadError}
                onRetry={() => void suggestionsQuery.refetch()}
              />
            ) : null}
            {active && result && result.groups.length === 0 ? (
              <EmptyState
                title={
                  result.sourceTotal === 0
                    ? messages.suggestions.shelvesWaiting
                    : messages.suggestions.noFreshMix
                }
                description={
                  result.sourceTotal === 0
                    ? messages.suggestions.addStartingPoint
                    : messages.suggestions.tryAnotherMix
                }
                action={
                  <Link
                    className="button button--primary button--md"
                    to="/discover"
                  >
                    {messages.suggestions.exploreTitles}
                  </Link>
                }
              />
            ) : null}
            {active &&
            result &&
            result.groups.length > 0 &&
            visibleGroups.length === 0 ? (
              <EmptyState
                title={messages.suggestions.noKindShelves({
                  kind:
                    kind === "movie"
                      ? messages.kind.movie
                      : messages.kind.tvShow,
                })}
                description={messages.suggestions.emptyOtherTab}
                action={
                  <div className="suggestions-empty-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => changeKind("all")}
                    >
                      {messages.suggestions.viewAll}
                    </Button>
                    <Link
                      className="button button--primary button--md"
                      to="/discover"
                    >
                      {messages.suggestions.exploreTitles}
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
