import type {
  CatalogDiscoverQuery,
  CatalogDiscoverSort,
} from "../../contracts/api-routes";
import type { CatalogItem } from "../types";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import { catalogPage } from "../api/normalize";
import { MediaDetailDialog, MediaGrid } from "../components/Catalog";
import { Page } from "../components/Page";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  SegmentedControl,
  SelectField,
  SkeletonGrid,
} from "../components/ui";

type DiscoverKind = "movie" | "series";

export interface DiscoverFilters {
  sort: CatalogDiscoverSort;
  genreIds: number[];
  originCountry: string;
  originalLanguage: string;
  year: string;
  dateFrom: string;
  dateTo: string;
  runtimeMin: string;
  runtimeMax: string;
  ratingMin: string;
  voteCountMin: string;
}

interface FilterLabels {
  genres: ReadonlyMap<number, string>;
  countries: ReadonlyMap<string, string>;
  languages: ReadonlyMap<string, string>;
}

export interface AppliedDiscoverFilter {
  key: string;
  label: string;
}

const HIGHEST_RATED_SORT: CatalogDiscoverSort = "vote_average.desc";
const HIGHEST_RATED_VOTE_FLOOR = 200;

const SORT_LABELS: Record<CatalogDiscoverSort, string> = {
  "popularity.asc": "Least popular",
  "popularity.desc": "Most popular",
  "vote_average.asc": "Lowest rated",
  "vote_average.desc": "Highest rated",
  "vote_count.asc": "Fewest votes",
  "vote_count.desc": "Most voted",
  "release_date.asc": "Oldest first",
  "release_date.desc": "Newest first",
  "primary_release_date.asc": "Oldest first",
  "primary_release_date.desc": "Newest first",
  "first_air_date.asc": "Oldest first",
  "first_air_date.desc": "Newest first",
  "title.asc": "Title A–Z",
  "title.desc": "Title Z–A",
  "name.asc": "Title A–Z",
  "name.desc": "Title Z–A",
  "original_title.asc": "Original title A–Z",
  "original_title.desc": "Original title Z–A",
  "original_name.asc": "Original title A–Z",
  "original_name.desc": "Original title Z–A",
  "revenue.asc": "Lowest box office",
  "revenue.desc": "Highest box office",
};

const MOVIE_SORTS: Array<{
  value: CatalogDiscoverSort;
  label: string;
}> = [
  { value: "popularity.desc", label: "Most popular" },
  { value: HIGHEST_RATED_SORT, label: "Highest rated" },
  { value: "vote_count.desc", label: "Most voted" },
  { value: "primary_release_date.desc", label: "Newest first" },
  { value: "primary_release_date.asc", label: "Oldest first" },
  { value: "title.asc", label: "Title A–Z" },
  { value: "revenue.desc", label: "Highest box office" },
];

const SERIES_SORTS: Array<{
  value: CatalogDiscoverSort;
  label: string;
}> = [
  { value: "popularity.desc", label: "Most popular" },
  { value: HIGHEST_RATED_SORT, label: "Highest rated" },
  { value: "vote_count.desc", label: "Most voted" },
  { value: "first_air_date.desc", label: "Newest first" },
  { value: "first_air_date.asc", label: "Oldest first" },
  { value: "name.asc", label: "Title A–Z" },
];

const RUNTIME_OPTIONS = [
  { value: "", label: "Any length" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
  { value: "120", label: "2 hours" },
  { value: "150", label: "2½ hours" },
  { value: "180", label: "3 hours" },
];

const VOTE_OPTIONS = [
  { value: "", label: "Any number" },
  { value: "0", label: "No minimum" },
  { value: "50", label: "50+ votes" },
  { value: "100", label: "100+ votes" },
  { value: "200", label: "200+ votes" },
  { value: "500", label: "500+ votes" },
  { value: "1000", label: "1,000+ votes" },
  { value: "5000", label: "5,000+ votes" },
];

const RATING_OPTIONS = [
  { value: "", label: "Any rating" },
  { value: "5", label: "5.0 and above" },
  { value: "6", label: "6.0 and above" },
  { value: "7", label: "7.0 and above" },
  { value: "7.5", label: "7.5 and above" },
  { value: "8", label: "8.0 and above" },
  { value: "9", label: "9.0 and above" },
];

export function createDefaultDiscoverFilters(): DiscoverFilters {
  return {
    sort: "popularity.desc",
    genreIds: [],
    originCountry: "",
    originalLanguage: "",
    year: "",
    dateFrom: "",
    dateTo: "",
    runtimeMin: "",
    runtimeMax: "",
    ratingMin: "",
    voteCountMin: "",
  };
}

export function discoverQueryFor(
  kind: DiscoverKind,
  filters: DiscoverFilters,
  page: number,
): CatalogDiscoverQuery {
  const minimumVotes = optionalNumber(filters.voteCountMin);
  const genreIds = [...new Set(filters.genreIds)].sort(
    (left, right) => left - right,
  );
  return {
    kind,
    sort: filters.sort,
    page,
    genres: genreIds.length ? genreIds.join(",") : undefined,
    originCountry: filters.originCountry || undefined,
    originalLanguage: filters.originalLanguage || undefined,
    year: optionalNumber(filters.year),
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    runtimeMin: optionalNumber(filters.runtimeMin),
    runtimeMax: optionalNumber(filters.runtimeMax),
    ratingMin: optionalNumber(filters.ratingMin),
    voteCountMin: minimumVotes,
  };
}

export function discoverFilterError(filters: DiscoverFilters): string | null {
  if (filters.year) {
    const year = Number(filters.year);
    if (!Number.isSafeInteger(year) || year < 1874 || year > 2200) {
      return "Year must be a whole number from 1874 to 2200.";
    }
  }
  if (filters.dateFrom && !validDiscoverDate(filters.dateFrom)) {
    return "Start date must be from 1874-01-01 to 2200-12-31.";
  }
  if (filters.dateTo && !validDiscoverDate(filters.dateTo)) {
    return "End date must be from 1874-01-01 to 2200-12-31.";
  }
  const minimumRuntime = optionalNumber(filters.runtimeMin);
  const maximumRuntime = optionalNumber(filters.runtimeMax);
  if (
    minimumRuntime !== undefined &&
    maximumRuntime !== undefined &&
    minimumRuntime > maximumRuntime
  ) {
    return "Maximum length must be at least the minimum length.";
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return "The end date must be on or after the start date.";
  }
  return null;
}

export function sortForKind(
  kind: DiscoverKind,
  sort: CatalogDiscoverSort,
): CatalogDiscoverSort {
  if (kind === "movie") {
    if (sort.startsWith("first_air_date.")) {
      return sort.endsWith(".asc")
        ? "primary_release_date.asc"
        : "primary_release_date.desc";
    }
    if (sort === "name.asc") return "title.asc";
    if (sort === "name.desc") return "title.desc";
    return sort;
  }
  if (
    sort.startsWith("primary_release_date.") ||
    sort.startsWith("release_date.")
  ) {
    return sort.endsWith(".asc") ? "first_air_date.asc" : "first_air_date.desc";
  }
  if (sort === "title.asc") return "name.asc";
  if (sort === "title.desc") return "name.desc";
  if (sort.startsWith("revenue.")) return "popularity.desc";
  return sort;
}

export function appliedDiscoverFilters(
  filters: DiscoverFilters,
  labels: FilterLabels,
): AppliedDiscoverFilter[] {
  const applied: AppliedDiscoverFilter[] = [];
  if (filters.sort !== "popularity.desc") {
    applied.push({ key: "sort", label: SORT_LABELS[filters.sort] });
  }
  for (const genreId of filters.genreIds) {
    applied.push({
      key: `genre:${genreId}`,
      label: labels.genres.get(genreId) ?? `Genre ${genreId}`,
    });
  }
  if (filters.originCountry) {
    applied.push({
      key: "originCountry",
      label:
        labels.countries.get(filters.originCountry) ?? filters.originCountry,
    });
  }
  if (filters.originalLanguage) {
    applied.push({
      key: "originalLanguage",
      label: `Language: ${
        labels.languages.get(filters.originalLanguage) ??
        filters.originalLanguage.toUpperCase()
      }`,
    });
  }
  if (filters.year) {
    applied.push({ key: "year", label: `Year: ${filters.year}` });
  }
  if (filters.dateFrom || filters.dateTo) {
    let label = `Until ${filters.dateTo}`;
    if (filters.dateFrom && filters.dateTo) {
      label = `Dates: ${filters.dateFrom} – ${filters.dateTo}`;
    } else if (filters.dateFrom) {
      label = `From ${filters.dateFrom}`;
    }
    applied.push({
      key: "dateRange",
      label,
    });
  }
  if (filters.runtimeMin || filters.runtimeMax) {
    const lower = filters.runtimeMin ? `${filters.runtimeMin} min` : "Any";
    const upper = filters.runtimeMax ? `${filters.runtimeMax} min` : "Any";
    applied.push({ key: "runtime", label: `Length: ${lower} – ${upper}` });
  }
  if (filters.ratingMin) {
    applied.push({
      key: "ratingMin",
      label: `Rated ${filters.ratingMin}+`,
    });
  }
  const effectiveVotes =
    optionalNumber(filters.voteCountMin) ??
    (filters.sort === HIGHEST_RATED_SORT
      ? HIGHEST_RATED_VOTE_FLOOR
      : undefined);
  if (effectiveVotes !== undefined && effectiveVotes > 0) {
    applied.push({
      key: "voteCountMin",
      label: `${effectiveVotes.toLocaleString("en-US")}+ votes`,
    });
  }
  return applied;
}

export function removeDiscoverFilter(
  filters: DiscoverFilters,
  key: string,
): DiscoverFilters {
  if (key.startsWith("genre:")) {
    const genreId = Number(key.slice("genre:".length));
    return {
      ...filters,
      genreIds: filters.genreIds.filter((id) => id !== genreId),
    };
  }
  if (key === "sort") return { ...filters, sort: "popularity.desc" };
  if (key === "dateRange") {
    return { ...filters, dateFrom: "", dateTo: "" };
  }
  if (key === "runtime") {
    return { ...filters, runtimeMin: "", runtimeMax: "" };
  }
  if (key === "voteCountMin") {
    return {
      ...filters,
      voteCountMin: filters.sort === HIGHEST_RATED_SORT ? "0" : "",
    };
  }
  if (
    key === "originCountry" ||
    key === "originalLanguage" ||
    key === "year" ||
    key === "ratingMin"
  ) {
    return { ...filters, [key]: "" };
  }
  return filters;
}

export function DiscoverPage() {
  const [kind, setKind] = useState<DiscoverKind>("movie");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<DiscoverFilters>(
    createDefaultDiscoverFilters,
  );
  const [draft, setDraft] = useState<DiscoverFilters>(filters);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLElement>(null);

  const genresQuery = useQuery({
    queryKey: ["catalog", "genres", kind],
    queryFn: ({ signal }) =>
      api.get("catalogGenres", { query: { kind }, signal }),
    staleTime: 24 * 60 * 60_000,
  });
  const languagesQuery = useQuery({
    queryKey: ["catalog", "languages"],
    queryFn: ({ signal }) => api.get("catalogLanguages", { signal }),
    staleTime: 24 * 60 * 60_000,
  });
  const countriesQuery = useQuery({
    queryKey: ["catalog", "countries"],
    queryFn: ({ signal }) => api.get("catalogCountries", { signal }),
    staleTime: 24 * 60 * 60_000,
  });

  const genres = genresQuery.data?.items ?? [];
  const languages = languagesQuery.data?.items ?? [];
  const countries = countriesQuery.data?.items ?? [];
  const filterLabels = useMemo<FilterLabels>(
    () => ({
      genres: new Map(genres.map((genre) => [genre.id, genre.name])),
      countries: new Map(
        countries.map((country) => [country.code, country.englishName]),
      ),
      languages: new Map(
        languages.map((language) => [language.code, language.englishName]),
      ),
    }),
    [countries, genres, languages],
  );
  const activeFilters = useMemo(
    () => appliedDiscoverFilters(filters, filterLabels),
    [filterLabels, filters],
  );
  const query = useMemo(
    () => discoverQueryFor(kind, filters, page),
    [filters, kind, page],
  );
  const validationError = discoverFilterError(draft);
  const draftFilterCount = appliedDiscoverFilters(draft, filterLabels).length;

  const discoverQuery = useQuery({
    queryKey: ["catalog", "discover", query],
    queryFn: ({ signal }) => api.get("catalogDiscover", { query, signal }),
    staleTime: 5 * 60_000,
  });
  const result = discoverQuery.data
    ? catalogPage(discoverQuery.data)
    : undefined;

  useEffect(() => {
    if (!filtersOpen) return;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      discoverFocusableElements(filterMenuRef.current)[0]?.focus();
    });
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!filterAnchorRef.current?.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFiltersOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = discoverFocusableElements(filterMenuRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        filterMenuRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (!filterMenuRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", handleKeyDown);
      if (
        previouslyFocused instanceof HTMLElement &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [filtersOpen]);

  function openFilters(): void {
    setDraft(filters);
    setFiltersOpen(true);
  }

  function applyFilters(): void {
    if (validationError) return;
    setFilters(draft);
    setPage(1);
    setFiltersOpen(false);
    filterAnchorRef.current
      ?.querySelector<HTMLButtonElement>(".discover-filter-trigger")
      ?.focus();
  }

  function clearFilters(): void {
    const next = createDefaultDiscoverFilters();
    setDraft(next);
    setFilters(next);
    setPage(1);
  }

  function removeFilter(key: string): void {
    const next = removeDiscoverFilter(filters, key);
    setFilters(next);
    setDraft(next);
    setPage(1);
  }

  function changeKind(nextKind: DiscoverKind): void {
    const nextFilters = {
      ...filters,
      sort: sortForKind(nextKind, filters.sort),
      genreIds: [],
    };
    setKind(nextKind);
    setFilters(nextFilters);
    setDraft(nextFilters);
    setSelected(null);
    setPage(1);
  }

  return (
    <Page
      eyebrow="Explore"
      title="Discover something remarkable"
      description="Popular, acclaimed, and newly released titles from around the world."
      wide
    >
      <div className="discover-toolbar">
        <SegmentedControl
          label="Media type"
          value={kind}
          options={[
            { value: "movie", label: "Movies" },
            { value: "series", label: "Shows" },
          ]}
          onChange={changeKind}
        />
        <div className="discover-filter-anchor" ref={filterAnchorRef}>
          <Button
            type="button"
            variant="secondary"
            className="discover-filter-trigger"
            onClick={() => {
              if (filtersOpen) setFiltersOpen(false);
              else openFilters();
            }}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            aria-controls="discover-filter-menu"
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            Filters
            {activeFilters.length ? (
              <span className="discover-filter-trigger__count">
                {activeFilters.length}
              </span>
            ) : null}
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={filtersOpen ? "is-open" : undefined}
            />
          </Button>

          {filtersOpen ? (
            <>
              <div
                className="discover-filter-scrim"
                aria-hidden="true"
                onClick={() => {
                  setFiltersOpen(false);
                  filterAnchorRef.current
                    ?.querySelector<HTMLButtonElement>(
                      ".discover-filter-trigger",
                    )
                    ?.focus();
                }}
              />
              <section
                ref={filterMenuRef}
                className="discover-filter-menu"
                id="discover-filter-menu"
                role="dialog"
                aria-modal="true"
                aria-labelledby="discover-filter-title"
                tabIndex={-1}
              >
                <div className="discover-filter-menu__header">
                  <div>
                    <span className="eyebrow">Refine discovery</span>
                    <h2 id="discover-filter-title">Find your next watch</h2>
                    <p>Stack filters, then apply them together.</p>
                  </div>
                  <IconButton
                    label="Close filters"
                    type="button"
                    onClick={() => {
                      setFiltersOpen(false);
                      filterAnchorRef.current
                        ?.querySelector<HTMLButtonElement>(
                          ".discover-filter-trigger",
                        )
                        ?.focus();
                    }}
                  >
                    <X size={19} />
                  </IconButton>
                </div>

                <div className="discover-filter-menu__body">
                  <div className="discover-filter-grid discover-filter-grid--top">
                    <SelectField
                      label="Sort by"
                      value={draft.sort}
                      onChange={(event) => {
                        const sort = event.target.value as CatalogDiscoverSort;
                        setDraft((current) => ({
                          ...current,
                          sort,
                          voteCountMin:
                            sort === HIGHEST_RATED_SORT &&
                            current.sort !== HIGHEST_RATED_SORT &&
                            (optionalNumber(current.voteCountMin) ?? 0) <= 0
                              ? ""
                              : current.voteCountMin,
                        }));
                      }}
                    >
                      {(kind === "movie" ? MOVIE_SORTS : SERIES_SORTS).map(
                        (option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ),
                      )}
                    </SelectField>
                    <SelectField
                      label="Minimum votes"
                      value={draft.voteCountMin}
                      hint={
                        draft.sort === HIGHEST_RATED_SORT
                          ? "Highest rated defaults to 200+ votes."
                          : undefined
                      }
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          voteCountMin: event.target.value,
                        }))
                      }
                    >
                      {VOTE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.value === "" &&
                          draft.sort === HIGHEST_RATED_SORT
                            ? `Default · ${HIGHEST_RATED_VOTE_FLOOR}+ votes`
                            : option.label}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  <fieldset className="discover-genre-fieldset">
                    <legend>Genres</legend>
                    <p>Match any selected genre.</p>
                    {genresQuery.isLoading ? (
                      <span className="discover-filter-loading">
                        Loading genres…
                      </span>
                    ) : null}
                    {genresQuery.isError ? (
                      <span className="discover-filter-warning">
                        Genres are temporarily unavailable.
                      </span>
                    ) : null}
                    {genres.length ? (
                      <div className="discover-genre-grid">
                        {genres.map((genre) => (
                          <label
                            key={genre.id}
                            className="discover-genre-option"
                          >
                            <input
                              type="checkbox"
                              checked={draft.genreIds.includes(genre.id)}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  genreIds: event.target.checked
                                    ? [...current.genreIds, genre.id]
                                    : current.genreIds.filter(
                                        (id) => id !== genre.id,
                                      ),
                                }))
                              }
                            />
                            <span>{genre.name}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </fieldset>

                  <div className="discover-filter-section">
                    <div className="discover-filter-section__heading">
                      <h3>Origin &amp; language</h3>
                      <p>
                        Filter where a title came from and its original audio.
                      </p>
                    </div>
                    <div className="discover-filter-grid">
                      <SelectField
                        label="Country of origin"
                        value={draft.originCountry}
                        disabled={countriesQuery.isLoading}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            originCountry: event.target.value,
                          }))
                        }
                      >
                        <option value="">Any country</option>
                        {countries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.englishName}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label="Original language"
                        value={draft.originalLanguage}
                        disabled={languagesQuery.isLoading}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            originalLanguage: event.target.value,
                          }))
                        }
                      >
                        <option value="">Any language</option>
                        {languages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.englishName}
                            {language.name !== language.englishName
                              ? ` · ${language.name}`
                              : ""}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    {countriesQuery.isError || languagesQuery.isError ? (
                      <p className="discover-filter-warning">
                        Some TMDB configuration choices are temporarily
                        unavailable.
                      </p>
                    ) : null}
                  </div>

                  <div className="discover-filter-section">
                    <div className="discover-filter-section__heading">
                      <h3>Release window</h3>
                      <p>Use one exact year or a custom date range.</p>
                    </div>
                    <div className="discover-filter-grid discover-filter-grid--three">
                      <Field
                        label="Exact year"
                        type="number"
                        inputMode="numeric"
                        min={1874}
                        max={2200}
                        step={1}
                        placeholder="e.g. 2024"
                        value={draft.year}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            year: event.target.value,
                            dateFrom: "",
                            dateTo: "",
                          }))
                        }
                      />
                      <Field
                        label="From"
                        type="date"
                        min="1874-01-01"
                        max="2200-12-31"
                        value={draft.dateFrom}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            year: "",
                            dateFrom: event.target.value,
                          }))
                        }
                      />
                      <Field
                        label="To"
                        type="date"
                        min="1874-01-01"
                        max="2200-12-31"
                        value={draft.dateTo}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            year: "",
                            dateTo: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="discover-filter-section">
                    <div className="discover-filter-section__heading">
                      <h3>Length &amp; quality</h3>
                      <p>Narrow the time commitment and audience rating.</p>
                    </div>
                    <div className="discover-filter-grid discover-filter-grid--three">
                      <SelectField
                        label="Minimum length"
                        value={draft.runtimeMin}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            runtimeMin: event.target.value,
                          }))
                        }
                      >
                        {RUNTIME_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label="Maximum length"
                        value={draft.runtimeMax}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            runtimeMax: event.target.value,
                          }))
                        }
                      >
                        {RUNTIME_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label="Minimum rating"
                        value={draft.ratingMin}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ratingMin: event.target.value,
                          }))
                        }
                      >
                        {RATING_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                  </div>
                </div>

                <div className="discover-filter-menu__footer">
                  <div aria-live="polite">
                    {validationError ? (
                      <p className="discover-filter-error">{validationError}</p>
                    ) : (
                      <p>
                        {draftFilterCount === 0
                          ? "No active filters"
                          : `${draftFilterCount} active filter${
                              draftFilterCount === 1 ? "" : "s"
                            }`}
                      </p>
                    )}
                  </div>
                  <div className="discover-filter-menu__actions">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDraft(createDefaultDiscoverFilters())}
                    >
                      <RotateCcw size={16} aria-hidden="true" /> Reset
                    </Button>
                    <Button
                      type="button"
                      disabled={Boolean(validationError)}
                      onClick={applyFilters}
                    >
                      Apply filters
                    </Button>
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>

      {activeFilters.length ? (
        <div className="discover-applied" aria-label="Applied filters">
          <span className="discover-applied__label">Applied</span>
          <div className="discover-applied__chips">
            {activeFilters.map((filter) => (
              <span className="discover-filter-chip" key={filter.key}>
                {filter.label}
                <button
                  type="button"
                  aria-label={`Remove ${filter.label} filter`}
                  onClick={() => removeFilter(filter.key)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="discover-applied__clear"
            onClick={clearFilters}
          >
            Clear all
          </button>
        </div>
      ) : null}

      {discoverQuery.isLoading ? <SkeletonGrid count={12} /> : null}
      {discoverQuery.isError ? (
        <ErrorState
          error={discoverQuery.error}
          onRetry={() => void discoverQuery.refetch()}
        />
      ) : null}
      {result && result.items.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Remove a filter or try a broader combination."
        />
      ) : null}
      {result?.items.length ? (
        <MediaGrid items={result.items} onSelect={setSelected} />
      ) : null}

      {result && result.totalPages > 1 ? (
        <nav className="pagination" aria-label="Discover pages">
          <IconButton
            label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <ChevronLeft size={20} />
          </IconButton>
          <span>
            Page <strong>{result.page}</strong> of {result.totalPages}
          </span>
          <IconButton
            label="Next page"
            disabled={page >= Math.min(result.totalPages, 500)}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight size={20} />
          </IconButton>
        </nav>
      ) : null}
      <MediaDetailDialog
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function validDiscoverDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1874 &&
    year <= 2200 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function discoverFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}
