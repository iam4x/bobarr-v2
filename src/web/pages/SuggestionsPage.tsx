import type { CatalogItem } from "../types";
import type { KeyboardEvent } from "react";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { api } from "../api/client";
import { catalogPage } from "../api/normalize";
import { MediaDetailDialog, MediaGrid } from "../components/Catalog";
import { Page } from "../components/Page";
import { Button, EmptyState, ErrorState, SkeletonGrid } from "../components/ui";

export type SuggestionKind = "movie" | "series";

const suggestionKinds: Array<{ value: SuggestionKind; label: string }> = [
  { value: "movie", label: "Movies" },
  { value: "series", label: "TV Shows" },
];

export function suggestionsForKind(
  items: CatalogItem[] | undefined,
  kind: SuggestionKind,
): CatalogItem[] {
  return items?.filter((item) => item.kind === kind) ?? [];
}

export function suggestionCounts(
  items: CatalogItem[] | undefined,
): Record<SuggestionKind, number> {
  return {
    movie: suggestionsForKind(items, "movie").length,
    series: suggestionsForKind(items, "series").length,
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
              <span className="suggestions-tab__count" aria-hidden="true">
                {counts[option.value]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SuggestionsPage() {
  const [kind, setKind] = useState<SuggestionKind>("movie");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const suggestionsQuery = useQuery({
    queryKey: ["catalog", "recommendations"],
    queryFn: ({ signal }) => api.get("catalogRecommendations", { signal }),
    staleTime: 15 * 60_000,
  });
  const result = suggestionsQuery.data
    ? catalogPage(suggestionsQuery.data)
    : undefined;
  const counts = result ? suggestionCounts(result.items) : undefined;
  const suggestions = suggestionsForKind(result?.items, kind);

  function changeKind(nextKind: SuggestionKind): void {
    setKind(nextKind);
    setSelected(null);
  }

  return (
    <Page
      eyebrow="For you"
      title="A few thoughtful suggestions"
      description={
        suggestionsQuery.data?.personalized
          ? "Recommendations shaped by the movies and shows already in your library."
          : "Popular movies and shows to help start your library."
      }
      actions={
        <Button
          type="button"
          variant="secondary"
          busy={suggestionsQuery.isFetching}
          onClick={() => void suggestionsQuery.refetch()}
        >
          <RefreshCw size={17} /> Refresh
        </Button>
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
            {counts[kind]} {kind === "movie" ? "movie" : "TV show"}
            {counts[kind] === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
      <section
        id={`suggestions-panel-${kind}`}
        className="suggestions-results"
        role="tabpanel"
        aria-labelledby={`suggestions-tab-${kind}`}
        tabIndex={0}
      >
        {suggestionsQuery.isLoading ? <SkeletonGrid count={12} /> : null}
        {suggestionsQuery.isError ? (
          <ErrorState
            error={suggestionsQuery.error}
            onRetry={() => void suggestionsQuery.refetch()}
          />
        ) : null}
        {result && result.items.length === 0 ? (
          <EmptyState
            title="Your taste profile is just getting started"
            description="Add a few titles to your library and Bobarr will find related recommendations."
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
        {result && result.items.length > 0 && suggestions.length === 0 ? (
          <EmptyState
            title={`No ${kind === "movie" ? "movie" : "TV show"} suggestions yet`}
            description={`Bobarr found suggestions in the ${kind === "movie" ? "TV Shows" : "Movies"} tab. Add more titles to your library to shape both lists.`}
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  changeKind(kind === "movie" ? "series" : "movie")
                }
              >
                View {kind === "movie" ? "TV Shows" : "Movies"}
              </Button>
            }
          />
        ) : null}
        {suggestions.length ? (
          <MediaGrid items={suggestions} onSelect={setSelected} />
        ) : null}
      </section>
      <MediaDetailDialog
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}
