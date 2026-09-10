import type { LibraryAvailability, LibrarySort } from "../../contracts/library";
import type { Messages } from "../i18n/en";

export type LibraryFilter = "all" | LibraryAvailability;

export interface LibraryBrowseFilters {
  filter: LibraryFilter;
  sort: LibrarySort;
  genreId: number | null;
  year: string;
  ratingMin: string;
  quality: string;
}

export const LIBRARY_SORT_OPTIONS: LibrarySort[] = [
  "added_at.desc",
  "updated_at.desc",
  "title.asc",
  "title.desc",
  "year.desc",
  "year.asc",
  "rating.desc",
  "rating.asc",
];

export const LIBRARY_QUALITY_OPTIONS = ["", "2160p", "1080p", "720p", "480p"];

export const LIBRARY_RATING_OPTIONS = ["", "6", "7", "7.5", "8"];

export function librarySortLabel(
  sort: LibrarySort,
  messages: Messages,
): string {
  switch (sort) {
    case "added_at.desc":
      return messages.library.sortRecentlyAdded;
    case "added_at.asc":
      return messages.library.sortOldestAdded;
    case "updated_at.desc":
      return messages.library.sortRecentlyUpdated;
    case "title.asc":
      return messages.library.sortTitleAsc;
    case "title.desc":
      return messages.library.sortTitleDesc;
    case "year.desc":
      return messages.library.sortNewestYear;
    case "year.asc":
      return messages.library.sortOldestYear;
    case "rating.desc":
      return messages.library.sortHighestRated;
    case "rating.asc":
      return messages.library.sortLowestRated;
    default: {
      const _exhaustive: never = sort;
      return _exhaustive;
    }
  }
}

export function libraryRatingLabel(value: string, messages: Messages): string {
  if (value === "") return messages.library.anyRating;
  const formatted = value.includes(".") ? value : `${value}.0`;
  return messages.library.ratingMin({ value: formatted });
}

export function libraryQualityLabel(value: string, messages: Messages): string {
  if (value === "") return messages.library.anyQuality;
  return value;
}

export function createDefaultLibraryBrowseFilters(): LibraryBrowseFilters {
  return {
    filter: "all",
    sort: "added_at.desc",
    genreId: null,
    year: "",
    ratingMin: "",
    quality: "",
  };
}

export function libraryAvailabilityParam(
  filter: LibraryFilter,
): LibraryAvailability | undefined {
  return filter === "all" ? undefined : filter;
}

export function optionalBrowseNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function libraryBrowseIsDefault(
  filters: LibraryBrowseFilters,
  search: string,
): boolean {
  const defaults = createDefaultLibraryBrowseFilters();
  return (
    search.trim() === "" &&
    filters.filter === defaults.filter &&
    filters.sort === defaults.sort &&
    filters.genreId === defaults.genreId &&
    filters.year === defaults.year &&
    filters.ratingMin === defaults.ratingMin &&
    filters.quality === defaults.quality
  );
}

export function libraryBrowseFromSearchParams(
  searchParams: URLSearchParams,
): Partial<LibraryBrowseFilters> & { search?: string; itemId?: string } {
  const filter = searchParams.get("availability");
  const sort = searchParams.get("sort");
  const genreId = Number(searchParams.get("genreId"));
  const year = searchParams.get("year") ?? "";
  const ratingMin = searchParams.get("ratingMin") ?? "";
  const quality = searchParams.get("quality") ?? "";
  const search = searchParams.get("q") ?? undefined;
  const itemId = searchParams.get("item") ?? undefined;

  return {
    ...(filter === "available" ||
    filter === "missing" ||
    filter === "active" ||
    filter === "failed"
      ? { filter }
      : {}),
    ...(sort === "added_at.desc" ||
    sort === "added_at.asc" ||
    sort === "title.asc" ||
    sort === "title.desc" ||
    sort === "year.desc" ||
    sort === "year.asc" ||
    sort === "rating.desc" ||
    sort === "rating.asc" ||
    sort === "updated_at.desc"
      ? { sort }
      : {}),
    ...(Number.isSafeInteger(genreId) && genreId > 0 ? { genreId } : {}),
    ...(year ? { year } : {}),
    ...(ratingMin ? { ratingMin } : {}),
    ...(quality ? { quality } : {}),
    ...(search === undefined ? {} : { search }),
    ...(itemId ? { itemId } : {}),
  };
}

export function writeLibraryBrowseSearchParams(
  previous: URLSearchParams,
  filters: LibraryBrowseFilters,
  search: string,
  itemId?: string | null,
): URLSearchParams {
  const next = new URLSearchParams(previous);
  const defaults = createDefaultLibraryBrowseFilters();

  if (filters.filter === "all") next.delete("availability");
  else next.set("availability", filters.filter);

  if (filters.sort === defaults.sort) next.delete("sort");
  else next.set("sort", filters.sort);

  if (filters.genreId === null) next.delete("genreId");
  else next.set("genreId", String(filters.genreId));

  if (!filters.year) next.delete("year");
  else next.set("year", filters.year);

  if (!filters.ratingMin) next.delete("ratingMin");
  else next.set("ratingMin", filters.ratingMin);

  if (!filters.quality) next.delete("quality");
  else next.set("quality", filters.quality);

  next.delete("view");

  const normalizedSearch = search.trim();
  if (!normalizedSearch) next.delete("q");
  else next.set("q", normalizedSearch);

  if (!itemId) next.delete("item");
  else next.set("item", itemId);

  return next;
}

export function libraryNeedsAttentionCount(summary: {
  missing: number;
  failed: number;
}): number {
  return summary.missing + summary.failed;
}
