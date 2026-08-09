import type { CatalogItem, LibraryItem } from "../types";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Film, ScanSearch, Sparkles, Tv } from "lucide-react";
import { Link } from "react-router";

import { api } from "../api/client";
import {
  collectionItems,
  normalizeCatalogRecommendations,
} from "../api/normalize";
import { Button, EmptyState, InlineSpinner } from "../components/ui";
import {
  formatRelativeDate,
  imageUrl,
  initials,
  mediaYear,
} from "../lib/format";

const SHELF_LIMIT = 12;

function episodeCode(item: LibraryItem): string {
  const season = item.seasonNumber;
  const episode = item.episodeNumber;
  if (
    typeof season !== "number" ||
    typeof episode !== "number" ||
    !Number.isSafeInteger(season) ||
    !Number.isSafeInteger(episode)
  ) {
    return "Episode";
  }
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function ShelfCard({
  item,
  onSelect,
  subtitle,
}: {
  item: LibraryItem;
  onSelect: (item: LibraryItem) => void;
  subtitle?: string;
}) {
  const poster = imageUrl(item.posterPath, "w342");
  return (
    <button
      type="button"
      className="library-shelf-card"
      onClick={() => onSelect(item)}
      aria-label={`Open ${item.title} details`}
    >
      <span className="library-shelf-card__poster" aria-hidden="true">
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <span className="poster-placeholder">{initials(item.title)}</span>
        )}
      </span>
      <span className="library-shelf-card__copy">
        <strong>{item.title}</strong>
        <small>
          {subtitle ??
            `${mediaYear(item)}${
              item.voteAverage || item.rating?.value
                ? ` · ${(item.rating?.value ?? item.voteAverage ?? 0).toFixed(1)}`
                : ""
            }`}
        </small>
      </span>
    </button>
  );
}

function EpisodeShelfCard({
  episode,
  series,
  onSelect,
}: {
  episode: LibraryItem;
  series: LibraryItem;
  onSelect: (series: LibraryItem) => void;
}) {
  const poster = imageUrl(series.posterPath ?? episode.posterPath, "w342");
  const acquiredAt =
    typeof episode.updatedAt === "string" ? episode.updatedAt : episode.addedAt;
  const relative = formatRelativeDate(acquiredAt);
  const code = episodeCode(episode);
  return (
    <button
      type="button"
      className="library-shelf-card library-shelf-card--episode"
      onClick={() => onSelect(series)}
      aria-label={`Open ${series.title}, ${code} ${episode.title}`}
    >
      <span className="library-shelf-card__poster" aria-hidden="true">
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <span className="poster-placeholder">{initials(series.title)}</span>
        )}
      </span>
      <span className="library-shelf-card__copy">
        <strong>{series.title}</strong>
        <small>
          {code} · {episode.title}
          {relative ? ` · ${relative}` : ""}
        </small>
      </span>
    </button>
  );
}

function LibraryShelf({
  title,
  description,
  items,
  loading,
  onSelect,
}: {
  title: string;
  description: string;
  items: LibraryItem[];
  loading: boolean;
  onSelect: (item: LibraryItem) => void;
}) {
  if (!loading && items.length === 0) return null;
  return (
    <section className="library-shelf" aria-label={title}>
      <header className="library-shelf__header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      {loading ? (
        <InlineSpinner label={`Loading ${title.toLowerCase()}…`} />
      ) : (
        <div className="library-shelf__rail">
          {items.map((item) => (
            <ShelfCard key={item.id} item={item} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

export function MediaLibraryShelves({
  kind,
  enabled,
  onSelect,
}: {
  kind: "movie" | "series";
  enabled: boolean;
  onSelect: (item: LibraryItem) => void;
}) {
  const label = kind === "movie" ? "movies" : "shows";
  const recentQuery = useQuery({
    queryKey: ["library", "shelves", kind, "recent"],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: {
          kind,
          sort: "added_at.desc",
          limit: SHELF_LIMIT,
          offset: 0,
        },
        signal,
      }),
    enabled,
    staleTime: 60_000,
  });
  const attentionMissingQuery = useQuery({
    queryKey: ["library", "shelves", kind, "missing"],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: {
          kind,
          availability: "missing",
          sort: "updated_at.desc",
          limit: SHELF_LIMIT,
          offset: 0,
        },
        signal,
      }),
    enabled,
    staleTime: 60_000,
  });
  const attentionFailedQuery = useQuery({
    queryKey: ["library", "shelves", kind, "failed"],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: {
          kind,
          availability: "failed",
          sort: "updated_at.desc",
          limit: SHELF_LIMIT,
          offset: 0,
        },
        signal,
      }),
    enabled,
    staleTime: 60_000,
  });
  const ratedQuery = useQuery({
    queryKey: ["library", "shelves", kind, "rated"],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: {
          kind,
          sort: "rating.desc",
          ratingMin: 7,
          limit: SHELF_LIMIT,
          offset: 0,
        },
        signal,
      }),
    enabled,
    staleTime: 60_000,
  });
  const recentEpisodesQuery = useQuery({
    queryKey: ["library", "shelves", "recent-episodes"],
    queryFn: async ({ signal }) => {
      const response = await api.get("listRecentEpisodeAcquisitions", {
        query: { limit: SHELF_LIMIT },
        signal,
      });
      return {
        items: response.items.map(({ episode, series }) => ({
          episode: collectionItems({ items: [episode] })[0] ?? episode,
          series: collectionItems({ items: [series] })[0] ?? series,
        })),
      };
    },
    enabled: enabled && kind === "series",
    staleTime: 60_000,
  });

  if (!enabled) return null;

  const recent = collectionItems(recentQuery.data);
  const attention = [
    ...collectionItems(attentionFailedQuery.data),
    ...collectionItems(attentionMissingQuery.data),
  ]
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .slice(0, SHELF_LIMIT);
  const rated = collectionItems(ratedQuery.data);
  const recentEpisodes = recentEpisodesQuery.data?.items ?? [];

  const topGenre = recent
    .flatMap((item) => item.genres ?? [])
    .reduce<Map<number, { id: number; name: string; count: number }>>(
      (counts, genre) => {
        const current = counts.get(genre.id);
        counts.set(genre.id, {
          id: genre.id,
          name: genre.name,
          count: (current?.count ?? 0) + 1,
        });
        return counts;
      },
      new Map(),
    );
  const genreLeader = [...topGenre.values()].sort(
    (left, right) => right.count - left.count,
  )[0];

  const genreQuery = useQuery({
    queryKey: ["library", "shelves", kind, "genre", genreLeader?.id],
    queryFn: ({ signal }) =>
      api.get("listLibrary", {
        query: {
          kind,
          genreId: genreLeader!.id,
          sort: "rating.desc",
          limit: SHELF_LIMIT,
          offset: 0,
        },
        signal,
      }),
    enabled: enabled && genreLeader !== undefined,
    staleTime: 60_000,
  });

  return (
    <div className="library-shelves">
      <LibraryShelf
        title="Recently added"
        description={`The newest ${label} to land in your library.`}
        items={recent}
        loading={recentQuery.isLoading}
        onSelect={onSelect}
      />
      {kind === "series" &&
      (recentEpisodesQuery.isLoading || recentEpisodes.length > 0) ? (
        <section
          className="library-shelf"
          aria-label="Recently downloaded episodes"
        >
          <header className="library-shelf__header">
            <div>
              <h3>Recently downloaded episodes</h3>
              <p>Fresh episode files that just landed in your library.</p>
            </div>
          </header>
          {recentEpisodesQuery.isLoading ? (
            <InlineSpinner label="Loading recently downloaded episodes…" />
          ) : (
            <div className="library-shelf__rail">
              {recentEpisodes.map(({ episode, series }) => (
                <EpisodeShelfCard
                  key={episode.id}
                  episode={episode}
                  series={series}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
      <LibraryShelf
        title="Needs attention"
        description="Missing or failed acquisitions that still need a release."
        items={attention}
        loading={
          attentionMissingQuery.isLoading || attentionFailedQuery.isLoading
        }
        onSelect={onSelect}
      />
      <LibraryShelf
        title="Highly rated"
        description={`Your library ${label} rated 7.0 and above.`}
        items={rated}
        loading={ratedQuery.isLoading}
        onSelect={onSelect}
      />
      {genreLeader ? (
        <LibraryShelf
          title={genreLeader.name}
          description={`A shelf drawn from the ${genreLeader.name.toLowerCase()} ${label} you already keep.`}
          items={collectionItems(genreQuery.data)}
          loading={genreQuery.isLoading}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

/** @deprecated Prefer MediaLibraryShelves. */
export function MovieLibraryShelves(props: {
  enabled: boolean;
  onSelect: (item: LibraryItem) => void;
}) {
  return <MediaLibraryShelves kind="movie" {...props} />;
}

export function LibraryEmptyGuidance({
  kind,
  onScan,
  scanBusy,
}: {
  kind: "movie" | "series";
  onScan: () => void;
  scanBusy: boolean;
}) {
  const isMovies = kind === "movie";
  return (
    <EmptyState
      title={
        isMovies
          ? "Your movie library is ready to grow"
          : "Your show library is ready to grow"
      }
      description="Start with files you already have, or let Bobarr find something new."
      action={
        <div className="library-empty-actions">
          <Button type="button" busy={scanBusy} onClick={onScan}>
            <ScanSearch size={16} />{" "}
            {isMovies ? "Scan existing movies" : "Scan existing shows"}
          </Button>
          <Link
            className="button button--secondary button--md"
            to="/suggestions"
          >
            <Sparkles size={16} /> Get suggestions
          </Link>
          <Link
            className="button button--secondary button--md"
            to={isMovies ? "/discover" : "/discover?kind=series"}
          >
            {isMovies ? <Film size={16} /> : <Tv size={16} />} Browse Discover
          </Link>
        </div>
      }
    />
  );
}

/** @deprecated Prefer LibraryEmptyGuidance. */
export function MovieLibraryEmptyGuidance(props: {
  onScan: () => void;
  scanBusy: boolean;
}) {
  return <LibraryEmptyGuidance kind="movie" {...props} />;
}

export function LibraryAttentionStrip({
  missing,
  failed,
  onShowMissing,
  onShowFailed,
}: {
  missing: number;
  failed: number;
  onShowMissing: () => void;
  onShowFailed: () => void;
}) {
  if (missing + failed === 0) return null;
  return (
    <div className="library-attention" role="status">
      <span className="library-attention__icon" aria-hidden="true">
        <AlertTriangle size={18} />
      </span>
      <div className="library-attention__copy">
        <strong>Library needs attention</strong>
        <p>
          {failed > 0 ? `${failed} failed` : null}
          {failed > 0 && missing > 0 ? " · " : null}
          {missing > 0 ? `${missing} missing` : null}
        </p>
      </div>
      <div className="library-attention__actions">
        {failed > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onShowFailed}
          >
            Show failed
          </Button>
        ) : null}
        {missing > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onShowMissing}
          >
            Show missing
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DiscoverForYouStrip({
  onSelect,
}: {
  onSelect: (item: CatalogItem) => void;
}) {
  const suggestionsQuery = useQuery({
    queryKey: ["catalog", "recommendations", "discover-strip"],
    queryFn: ({ signal }) =>
      api.get("catalogRecommendations", { query: {}, signal }),
    staleTime: 15 * 60_000,
  });
  const result =
    suggestionsQuery.data === undefined
      ? undefined
      : normalizeCatalogRecommendations(suggestionsQuery.data);
  const items =
    result?.groups.flatMap((group) => group.items).slice(0, 12) ?? [];
  if (suggestionsQuery.isLoading) {
    return (
      <section className="discover-foryou" aria-label="For you">
        <InlineSpinner label="Loading suggestions…" />
      </section>
    );
  }
  if (items.length === 0) return null;
  return (
    <section className="discover-foryou" aria-label="For you">
      <header className="discover-foryou__header">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} aria-hidden="true" /> For you
          </span>
          <h2>Suggestions from your library</h2>
          <p>A quick mix before you dive into filters.</p>
        </div>
        <Link className="button button--ghost button--sm" to="/suggestions">
          See all
        </Link>
      </header>
      <div className="discover-foryou__rail">
        {items.map((item) => {
          const poster = imageUrl(item.posterPath, "w342");
          return (
            <button
              type="button"
              className="library-shelf-card"
              key={`${item.kind}-${item.id}`}
              onClick={() => onSelect(item)}
              aria-label={`View ${item.title}`}
            >
              <span className="library-shelf-card__poster" aria-hidden="true">
                {poster ? (
                  <img src={poster} alt="" loading="lazy" />
                ) : (
                  <span className="poster-placeholder">
                    {initials(item.title)}
                  </span>
                )}
              </span>
              <span className="library-shelf-card__copy">
                <strong>{item.title}</strong>
                <small>
                  {mediaYear(item)} ·{" "}
                  {item.kind === "movie" ? "Movie" : "Series"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DiscoverSearchJump({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="discover-search-jump"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Film size={18} aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder="Search the catalog…"
        aria-label="Search the catalog"
        onChange={(event) => onChange(event.target.value)}
      />
      <Button type="submit" size="sm">
        Search
      </Button>
    </form>
  );
}
