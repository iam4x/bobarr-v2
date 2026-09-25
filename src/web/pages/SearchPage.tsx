import type { CatalogItem, CatalogPage } from "../types";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { api } from "../api/client";
import { catalogPage } from "../api/normalize";
import { MediaDetailDialog, MediaGrid } from "../components/Catalog";
import { Page } from "../components/Page";
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  SegmentedControl,
  SkeletonGrid,
} from "../components/ui";
import { useUi } from "../i18n/ui";

type SearchKind = "all" | "movie" | "series";
export const SEARCH_DEBOUNCE_MS = 350;

export function normalizedSearchTerm(value: string): string {
  const normalized = value.trim();
  return normalized.length >= 2 ? normalized : "";
}

export function currentSearchData<T>(
  query: string,
  data: T | undefined,
): T | undefined {
  return normalizedSearchTerm(query) ? data : undefined;
}

/** TMDB serves at most 500 result pages. */
const MAX_SEARCH_PAGE = 500;

/** Joins loaded result pages, dropping titles TMDB repeats across pages. */
export function mergeSearchPages(pages: readonly CatalogPage[]): CatalogPage {
  const seen = new Set<string>();
  const items: CatalogItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const key = `${item.kind}:${item.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  const last = pages.at(-1);
  return {
    items,
    page: last?.page ?? 1,
    totalPages: last?.totalPages ?? 1,
    totalItems: pages[0]?.totalItems,
  };
}

export function SearchPage() {
  const { messages } = useUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const kind = (searchParams.get("kind") as SearchKind | null) ?? "all";
  const [draft, setDraft] = useState(query);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const cacheKey = query.toLocaleLowerCase();
  const hasQuery = Boolean(normalizedSearchTerm(query));
  const hasDraft = Boolean(normalizedSearchTerm(draft));

  const searchQuery = useInfiniteQuery({
    queryKey: ["catalog", "search", cacheKey, kind],
    queryFn: async ({ pageParam, signal }) =>
      catalogPage(
        await api.get("catalogSearch", {
          query: {
            query,
            kind: kind === "all" ? undefined : kind,
            ...(pageParam > 1 ? { page: pageParam } : {}),
          },
          signal,
        }),
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < Math.min(lastPage.totalPages, MAX_SEARCH_PAGE)
        ? lastPage.page + 1
        : undefined,
    enabled: hasQuery,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[3] === kind ? previousData : undefined,
  });
  const currentData = currentSearchData(draft, searchQuery.data);
  const result = currentData ? mergeSearchPages(currentData.pages) : undefined;
  // Previous results stay visible while a new query loads; mark them stale.
  const refreshing = searchQuery.isPlaceholderData && searchQuery.isFetching;

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
      eyebrow={messages.search.eyebrow}
      title={messages.search.title}
      description={messages.search.description}
      wide
    >
      <form className="search-hero" role="search" onSubmit={submit}>
        <div className="search-box">
          <Search aria-hidden="true" size={22} />
          <input
            type="search"
            value={draft}
            autoFocus
            aria-label={messages.search.inputLabel}
            placeholder={messages.search.placeholder}
            onChange={(event) => setDraft(event.target.value)}
          />
          {draft ? (
            <IconButton
              label={messages.search.clear}
              type="button"
              onClick={clearSearch}
            >
              <X size={18} />
            </IconButton>
          ) : null}
          <button type="submit" className="search-box__submit">
            {messages.search.submit}
          </button>
        </div>
        <SegmentedControl
          label={messages.search.mediaType}
          value={kind}
          options={[
            { value: "all", label: messages.kind.all },
            { value: "movie", label: messages.nav.movies },
            { value: "series", label: messages.nav.shows },
          ]}
          onChange={changeKind}
        />
      </form>

      {!hasDraft ? (
        <div className="search-prompt">
          <span className="search-prompt__orb">
            <Search size={29} />
          </span>
          <h2>{messages.search.promptTitle}</h2>
          <p>{messages.search.promptBody}</p>
        </div>
      ) : null}
      {hasDraft && searchQuery.isLoading ? <SkeletonGrid /> : null}
      {hasDraft && searchQuery.isError ? (
        <ErrorState
          error={searchQuery.error}
          onRetry={() => void searchQuery.refetch()}
        />
      ) : null}
      {result && result.items.length === 0 ? (
        <EmptyState
          title={messages.search.noMatchesTitle}
          description={messages.search.noMatches({ query })}
        />
      ) : null}
      {result?.items.length ? (
        <section
          className={refreshing ? "search-results is-refreshing" : undefined}
          aria-busy={refreshing || undefined}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">{messages.search.results}</span>
              <h2>
                {messages.search.titleCount({
                  count: result.totalItems ?? result.items.length,
                })}
              </h2>
            </div>
          </div>
          <MediaGrid items={result.items} onSelect={setSelected} />
          {searchQuery.hasNextPage && !refreshing ? (
            <div className="load-more-row">
              <Button
                type="button"
                variant="secondary"
                busy={searchQuery.isFetchingNextPage}
                onClick={() => void searchQuery.fetchNextPage()}
              >
                {searchQuery.isFetchingNextPage
                  ? messages.common.loadingEllipsis
                  : messages.common.loadMore}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      <MediaDetailDialog
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}
