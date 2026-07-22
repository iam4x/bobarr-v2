import type { CatalogItem } from "../types";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { api } from "../api/client";
import { catalogPage } from "../api/normalize";
import { MediaDetailDialog, MediaGrid } from "../components/Catalog";
import { Page } from "../components/Page";
import {
  EmptyState,
  ErrorState,
  IconButton,
  SegmentedControl,
  SkeletonGrid,
} from "../components/ui";

type SearchKind = "all" | "movie" | "series";
export const SEARCH_DEBOUNCE_MS = 350;

export function normalizedSearchTerm(value: string): string {
  const normalized = value.trim();
  return normalized.length >= 2 ? normalized : "";
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const kind = (searchParams.get("kind") as SearchKind | null) ?? "all";
  const [draft, setDraft] = useState(query);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const cacheKey = query.toLocaleLowerCase();

  const searchQuery = useQuery({
    queryKey: ["catalog", "search", cacheKey, kind],
    queryFn: ({ signal }) =>
      api.get("catalogSearch", {
        query: {
          query,
          kind: kind === "all" ? undefined : kind,
        },
        signal,
      }),
    enabled: query.trim().length >= 2,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[3] === kind ? previousData : undefined,
  });
  const result = searchQuery.data ? catalogPage(searchQuery.data) : undefined;

  useEffect(() => {
    setDraft((current) =>
      normalizedSearchTerm(current) === query ? current : query,
    );
  }, [query]);

  useEffect(() => {
    const normalized = normalizedSearchTerm(draft);
    if (normalized === query) return;
    const timeout = window.setTimeout(() => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (normalized) next.set("q", normalized);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [draft, query, setSearchParams]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizedSearchTerm(draft);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (normalized) next.set("q", normalized);
      else next.delete("q");
      if (kind === "all") next.delete("kind");
      else next.set("kind", kind);
      return next;
    });
  }

  function clearSearch() {
    setDraft("");
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("q");
        return next;
      },
      { replace: true },
    );
  }

  function changeKind(nextKind: SearchKind) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextKind === "all") next.delete("kind");
      else next.set("kind", nextKind);
      return next;
    });
  }

  return (
    <Page
      eyebrow="TMDB catalog"
      title="Find your next favorite"
      description="Search movies and television, then let Bobarr take care of the rest."
      wide
    >
      <form className="search-hero" role="search" onSubmit={submit}>
        <div className="search-box">
          <Search aria-hidden="true" size={22} />
          <input
            type="search"
            value={draft}
            autoFocus
            aria-label="Search movies and shows"
            placeholder="Search movies and shows…"
            onChange={(event) => setDraft(event.target.value)}
          />
          {draft ? (
            <IconButton
              label="Clear search"
              type="button"
              onClick={clearSearch}
            >
              <X size={18} />
            </IconButton>
          ) : null}
          <button type="submit" className="search-box__submit">
            Search
          </button>
        </div>
        <SegmentedControl
          label="Media type"
          value={kind}
          options={[
            { value: "all", label: "Everything" },
            { value: "movie", label: "Movies" },
            { value: "series", label: "Shows" },
          ]}
          onChange={changeKind}
        />
      </form>

      {!query ? (
        <div className="search-prompt">
          <span className="search-prompt__orb">
            <Search size={29} />
          </span>
          <h2>What are you looking for?</h2>
          <p>
            Search by title. Results are matched with TMDB metadata before
            acquisition.
          </p>
        </div>
      ) : null}
      {searchQuery.isLoading ? <SkeletonGrid /> : null}
      {searchQuery.isError ? (
        <ErrorState
          error={searchQuery.error}
          onRetry={() => void searchQuery.refetch()}
        />
      ) : null}
      {result && result.items.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`We couldn’t find anything matching “${query}”. Check the spelling or try another title.`}
        />
      ) : null}
      {result?.items.length ? (
        <section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Results</span>
              <h2>{result.totalItems ?? result.items.length} titles</h2>
            </div>
          </div>
          <MediaGrid items={result.items} onSelect={setSelected} />
        </section>
      ) : null}
      <MediaDetailDialog
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}
