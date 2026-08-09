import type { LibraryAvailability, LibrarySort } from "../../contracts/library";

export type LibraryFilter = "all" | LibraryAvailability;

export interface LibraryBrowseFilters {
  filter: LibraryFilter;
  sort: LibrarySort;
  genreId: number | null;
  year: string;
  ratingMin: string;
  quality: string;
}

export const LIBRARY_SORT_OPTIONS: Array<{
  value: LibrarySort;
  label: string;
}> = [
  { value: "added_at.desc", label: "Recently added" },
  { value: "updated_at.desc", label: "Recently updated" },
  { value: "title.asc", label: "Title A–Z" },
  { value: "title.desc", label: "Title Z–A" },
  { value: "year.desc", label: "Newest year" },
  { value: "year.asc", label: "Oldest year" },
  { value: "rating.desc", label: "Highest rated" },
  { value: "rating.asc", label: "Lowest rated" },
];

export const LIBRARY_QUALITY_OPTIONS = [
  { value: "", label: "Any quality" },
  { value: "2160p", label: "2160p" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
];

export const LIBRARY_RATING_OPTIONS = [
  { value: "", label: "Any rating" },
  { value: "6", label: "6.0+" },
  { value: "7", label: "7.0+" },
  { value: "7.5", label: "7.5+" },
  { value: "8", label: "8.0+" },
];

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
