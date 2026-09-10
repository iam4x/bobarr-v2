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
  EyeOff,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { DiscoverForYouStrip, DiscoverSearchJump } from "./MovieLibraryExtras";
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
import { en, type Messages } from "../i18n/en";
import { useUi } from "../i18n/ui";

type DiscoverKind = "movie" | "series";

export interface DiscoverFilters {
  sort: CatalogDiscoverSort;
  genreIds: number[];
  actorId: number | null;
  actorName: string;
  originCountry: string;
  originalLanguage: string;
  year: string;
  dateFrom: string;
  dateTo: string;
  runtimeMin: string;
  runtimeMax: string;
  ratingMin: string;
  voteCountMin: string;
  hideOwned: boolean;
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

const MOVIE_SORTS: CatalogDiscoverSort[] = [
  "popularity.desc",
  HIGHEST_RATED_SORT,
  "vote_count.desc",
  "primary_release_date.desc",
  "primary_release_date.asc",
  "title.asc",
  "revenue.desc",
];

const SERIES_SORTS: CatalogDiscoverSort[] = [
  "popularity.desc",
  HIGHEST_RATED_SORT,
  "vote_count.desc",
  "first_air_date.desc",
  "first_air_date.asc",
  "name.asc",
];

const RUNTIME_VALUES = ["", "30", "60", "90", "120", "150", "180"];
const VOTE_VALUES = ["", "0", "50", "100", "200", "500", "1000", "5000"];
const RATING_VALUES = ["", "5", "6", "7", "7.5", "8", "9"];

function runtimeLabel(value: string, messages: Messages): string {
  if (value === "") return messages.discover.anyLength;
  if (value === "30") return messages.discover.minutes({ count: 30 });
  if (value === "60") return messages.discover.hours({ count: 1 });
  if (value === "90") return messages.discover.hoursAndHalf({ count: 1 });
  if (value === "120") return messages.discover.hours({ count: 2 });
  if (value === "150") return messages.discover.hoursAndHalf({ count: 2 });
  if (value === "180") return messages.discover.hours({ count: 3 });
  return messages.discover.minutes({ count: Number(value) });
}

function voteLabel(value: string, messages: Messages): string {
  if (value === "") return messages.discover.anyNumber;
  if (value === "0") return messages.discover.noMinimum;
  return messages.discover.votes({ count: Number(value) });
}

function ratingLabel(value: string, messages: Messages): string {
  if (value === "") return messages.discover.anyRating;
  const formatted = value.includes(".") ? value : `${value}.0`;
  return messages.discover.ratingAndAbove({ value: formatted });
}

export function createDefaultDiscoverFilters(): DiscoverFilters {
  return {
    sort: "popularity.desc",
    genreIds: [],
    actorId: null,
    actorName: "",
    originCountry: "",
    originalLanguage: "",
    year: "",
    dateFrom: "",
    dateTo: "",
    runtimeMin: "",
    runtimeMax: "",
    ratingMin: "",
    voteCountMin: "",
    hideOwned: true,
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
    actorId: filters.actorId ?? undefined,
    originCountry: filters.originCountry || undefined,
    originalLanguage: filters.originalLanguage || undefined,
    year: optionalNumber(filters.year),
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    runtimeMin: optionalNumber(filters.runtimeMin),
    runtimeMax: optionalNumber(filters.runtimeMax),
    ratingMin: optionalNumber(filters.ratingMin),
    voteCountMin: minimumVotes,
    hideOwned: filters.hideOwned || undefined,
  };
}

export function discoverFilterError(
  filters: DiscoverFilters,
  messages: Messages = en,
): string | null {
  if (filters.year) {
    const year = Number(filters.year);
    if (!Number.isSafeInteger(year) || year < 1874 || year > 2200) {
      return messages.discover.yearRange;
    }
  }
  if (filters.dateFrom && !validDiscoverDate(filters.dateFrom)) {
    return messages.discover.startDateRange;
  }
  if (filters.dateTo && !validDiscoverDate(filters.dateTo)) {
    return messages.discover.endDateRange;
  }
  const minimumRuntime = optionalNumber(filters.runtimeMin);
  const maximumRuntime = optionalNumber(filters.runtimeMax);
  if (
    minimumRuntime !== undefined &&
    maximumRuntime !== undefined &&
    minimumRuntime > maximumRuntime
  ) {
    return messages.discover.runtimeOrder;
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return messages.discover.dateOrder;
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
  messages: Messages = en,
): AppliedDiscoverFilter[] {
  const applied: AppliedDiscoverFilter[] = [];
  if (filters.sort !== "popularity.desc") {
    applied.push({ key: "sort", label: messages.discover.sort[filters.sort] });
  }
  if (filters.actorId !== null) {
    applied.push({
      key: "actor",
      label: filters.actorName
        ? messages.discover.actor({ name: filters.actorName })
        : messages.discover.tmdbPerson({ id: filters.actorId }),
    });
  }
  for (const genreId of filters.genreIds) {
    applied.push({
      key: `genre:${genreId}`,
      label:
        labels.genres.get(genreId) ??
        messages.discover.genreFallback({ id: genreId }),
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
      label: messages.discover.languagePrefix({
        name:
          labels.languages.get(filters.originalLanguage) ??
          filters.originalLanguage.toUpperCase(),
      }),
    });
  }
  if (filters.year) {
    applied.push({
      key: "year",
      label: messages.discover.yearPrefix({ year: filters.year }),
    });
  }
  if (filters.dateFrom || filters.dateTo) {
    let label = messages.discover.until({ date: filters.dateTo });
    if (filters.dateFrom && filters.dateTo) {
      label = messages.discover.dateRange({
        from: filters.dateFrom,
        to: filters.dateTo,
      });
    } else if (filters.dateFrom) {
      label = messages.discover.fromDate({ date: filters.dateFrom });
    }
    applied.push({
      key: "dateRange",
      label,
    });
  }
  if (filters.runtimeMin || filters.runtimeMax) {
    const lower = filters.runtimeMin
      ? messages.discover.minutesShort({ count: filters.runtimeMin })
      : messages.discover.any;
    const upper = filters.runtimeMax
      ? messages.discover.minutesShort({ count: filters.runtimeMax })
      : messages.discover.any;
    applied.push({
      key: "runtime",
      label: messages.discover.lengthRange({ lower, upper }),
    });
  }
  if (filters.ratingMin) {
    applied.push({
      key: "ratingMin",
      label: messages.discover.rated({ value: filters.ratingMin }),
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
      label: messages.discover.votes({ count: effectiveVotes }),
    });
  }
  if (!filters.hideOwned) {
    applied.push({ key: "hideOwned", label: messages.discover.showingOwned });
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
  if (key === "actor") {
    return { ...filters, actorId: null, actorName: "" };
  }
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
  if (key === "hideOwned") {
    return { ...filters, hideOwned: true };
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

export function discoverFiltersFromSearchParams(
  searchParams: URLSearchParams,
): Partial<DiscoverFilters> & { kind?: DiscoverKind; page?: number } {
  const kind = searchParams.get("kind");
  const page = Number(searchParams.get("page"));
  const sort = searchParams.get("sort") as CatalogDiscoverSort | null;
  const genres = searchParams.get("genres");
  const genreIds = genres
    ? genres
        .split(",")
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    : undefined;
  const hideOwned = searchParams.get("hideOwned");
  const actor = discoverActorFromSearchParams(searchParams);
  return {
    ...(kind === "movie" || kind === "series" ? { kind } : {}),
    ...(Number.isSafeInteger(page) && page > 0 ? { page } : {}),
    ...(sort ? { sort } : {}),
    ...(genreIds && genreIds.length > 0 ? { genreIds } : {}),
    ...(actor ? { actorId: actor.tmdbId, actorName: actor.name } : {}),
    ...(searchParams.get("originCountry")
      ? { originCountry: searchParams.get("originCountry")! }
      : {}),
    ...(searchParams.get("originalLanguage")
      ? { originalLanguage: searchParams.get("originalLanguage")! }
      : {}),
    ...(searchParams.get("year") ? { year: searchParams.get("year")! } : {}),
    ...(searchParams.get("dateFrom")
      ? { dateFrom: searchParams.get("dateFrom")! }
      : {}),
    ...(searchParams.get("dateTo")
      ? { dateTo: searchParams.get("dateTo")! }
      : {}),
    ...(searchParams.get("runtimeMin")
      ? { runtimeMin: searchParams.get("runtimeMin")! }
      : {}),
    ...(searchParams.get("runtimeMax")
      ? { runtimeMax: searchParams.get("runtimeMax")! }
      : {}),
    ...(searchParams.get("ratingMin")
      ? { ratingMin: searchParams.get("ratingMin")! }
      : {}),
    ...(searchParams.get("voteCountMin")
      ? { voteCountMin: searchParams.get("voteCountMin")! }
      : {}),
    ...discoverHideOwnedFromParam(hideOwned),
  };
}

function discoverHideOwnedFromParam(
  hideOwned: string | null,
): Pick<DiscoverFilters, "hideOwned"> | object {
  if (hideOwned === "0" || hideOwned === "false") return { hideOwned: false };
  if (hideOwned === "1" || hideOwned === "true") return { hideOwned: true };
  return {};
}

export function writeDiscoverSearchParams(
  previous: URLSearchParams,
  kind: DiscoverKind,
  filters: DiscoverFilters,
  page: number,
): URLSearchParams {
  const next = new URLSearchParams();
  const defaults = createDefaultDiscoverFilters();
  if (kind !== "movie") next.set("kind", kind);
  if (page > 1) next.set("page", String(page));
  if (filters.sort !== defaults.sort) next.set("sort", filters.sort);
  if (filters.genreIds.length) {
    next.set(
      "genres",
      [...new Set(filters.genreIds)]
        .sort((left, right) => left - right)
        .join(","),
    );
  }
  if (filters.actorId !== null) {
    next.set("actorId", String(filters.actorId));
    if (filters.actorName) next.set("actorName", filters.actorName);
  }
  if (filters.originCountry) next.set("originCountry", filters.originCountry);
  if (filters.originalLanguage)
    next.set("originalLanguage", filters.originalLanguage);
  if (filters.year) next.set("year", filters.year);
  if (filters.dateFrom) next.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) next.set("dateTo", filters.dateTo);
  if (filters.runtimeMin) next.set("runtimeMin", filters.runtimeMin);
  if (filters.runtimeMax) next.set("runtimeMax", filters.runtimeMax);
  if (filters.ratingMin) next.set("ratingMin", filters.ratingMin);
  if (filters.voteCountMin) next.set("voteCountMin", filters.voteCountMin);
  if (!filters.hideOwned) next.set("hideOwned", "0");
  // Preserve unrelated params such as future deep links.
  for (const [key, value] of previous.entries()) {
    if (!next.has(key) && key.startsWith("utm_")) next.set(key, value);
  }
  return next;
}

export function DiscoverPage() {
  const { messages } = useUi();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeState = discoverFiltersFromSearchParams(searchParams);
  const routeActor = discoverActorFromSearchParams(searchParams);
  const [kind, setKind] = useState<DiscoverKind>(routeState.kind ?? "movie");
  const [page, setPage] = useState(routeState.page ?? 1);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [filters, setFilters] = useState<DiscoverFilters>(() => ({
    ...createDefaultDiscoverFilters(),
    ...routeState,
    actorId: routeActor?.tmdbId ?? routeState.actorId ?? null,
    actorName: routeActor?.name ?? routeState.actorName ?? "",
  }));
  const [draft, setDraft] = useState<DiscoverFilters>(filters);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLElement>(null);
  const showForYou =
    page === 1 &&
    filters.sort === "popularity.desc" &&
    filters.genreIds.length === 0 &&
    filters.actorId === null &&
    !filters.year &&
    !filters.dateFrom &&
    !filters.dateTo &&
    !filters.originCountry &&
    !filters.originalLanguage &&
    !filters.runtimeMin &&
    !filters.runtimeMax &&
    !filters.ratingMin &&
    !filters.voteCountMin;

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
    () => appliedDiscoverFilters(filters, filterLabels, messages),
    [filterLabels, filters, messages],
  );
  const query = useMemo(
    () => discoverQueryFor(kind, filters, page),
    [filters, kind, page],
  );
  const validationError = discoverFilterError(draft, messages);
  const draftFilterCount = appliedDiscoverFilters(
    draft,
    filterLabels,
    messages,
  ).length;

  const discoverQuery = useQuery({
    queryKey: ["catalog", "discover", query],
    queryFn: ({ signal }) => api.get("catalogDiscover", { query, signal }),
    staleTime: 5 * 60_000,
  });
  const result = discoverQuery.data
    ? catalogPage(discoverQuery.data)
    : undefined;

  useEffect(() => {
    const actorId = routeActor?.tmdbId ?? null;
    const actorName = routeActor?.name ?? "";
    const applyRouteActor = (current: DiscoverFilters): DiscoverFilters =>
      current.actorId === actorId && current.actorName === actorName
        ? current
        : { ...current, actorId, actorName };
    setFilters(applyRouteActor);
    setDraft(applyRouteActor);
    if (routeActor) setKind("movie");
    setPage(1);
  }, [routeActor?.name, routeActor?.tmdbId]);

  useEffect(() => {
    const genres = searchParams.get("genres");
    if (!genres || routeActor) return;
    const genreIds = genres
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    if (genreIds.length === 0) return;
    setFilters((current) =>
      current.genreIds.join(",") === genreIds.join(",")
        ? current
        : { ...current, genreIds },
    );
    setDraft((current) =>
      current.genreIds.join(",") === genreIds.join(",")
        ? current
        : { ...current, genreIds },
    );
  }, [routeActor, searchParams]);

  useEffect(() => {
    setSearchParams(
      (previous) => writeDiscoverSearchParams(previous, kind, filters, page),
      { replace: true },
    );
  }, [filters, kind, page, setSearchParams]);

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
    clearActorSearchParams(setSearchParams);
  }

  function removeFilter(key: string): void {
    const next = removeDiscoverFilter(filters, key);
    setFilters(next);
    setDraft(next);
    setPage(1);
    if (key === "actor") clearActorSearchParams(setSearchParams);
  }

  function changeKind(nextKind: DiscoverKind): void {
    const nextFilters = {
      ...filters,
      sort: sortForKind(nextKind, filters.sort),
      genreIds: [],
      ...(nextKind === "series" ? { actorId: null, actorName: "" } : {}),
    };
    setKind(nextKind);
    setFilters(nextFilters);
    setDraft(nextFilters);
    setSelected(null);
    setPage(1);
    if (nextKind === "series") clearActorSearchParams(setSearchParams);
  }

  return (
    <Page
      eyebrow={messages.discover.eyebrow}
      title={messages.discover.title}
      description={messages.discover.description}
      wide
    >
      <div className="discover-entry">
        <DiscoverSearchJump
          value={catalogSearch}
          onChange={setCatalogSearch}
          onSubmit={() => {
            const query = catalogSearch.trim();
            if (query.length < 2) return;
            navigate(
              `/search?q=${encodeURIComponent(query)}${
                kind === "series" ? "&kind=series" : ""
              }`,
            );
          }}
        />
        <div className="discover-entry__links">
          <Link className="button button--secondary button--sm" to="/search">
            <Search size={15} /> {messages.discover.advancedSearch}
          </Link>
          <Link
            className="button button--secondary button--sm"
            to="/suggestions"
          >
            <Sparkles size={15} /> {messages.discover.suggestionsLink}
          </Link>
        </div>
      </div>

      {showForYou ? <DiscoverForYouStrip onSelect={setSelected} /> : null}

      <div className="discover-toolbar">
        <SegmentedControl
          label={messages.discover.mediaType}
          value={kind}
          options={[
            { value: "movie", label: messages.nav.movies },
            { value: "series", label: messages.nav.shows },
          ]}
          onChange={changeKind}
        />
        <Button
          type="button"
          variant={filters.hideOwned ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={filters.hideOwned}
          onClick={() => {
            const next = { ...filters, hideOwned: !filters.hideOwned };
            setFilters(next);
            setDraft(next);
            setPage(1);
          }}
        >
          <EyeOff size={16} aria-hidden="true" />
          {filters.hideOwned
            ? messages.discover.hideOwned
            : messages.discover.showOwned}
        </Button>
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
            {messages.discover.filters}
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
                    <span className="eyebrow">
                      {messages.discover.refineEyebrow}
                    </span>
                    <h2 id="discover-filter-title">
                      {messages.discover.refineTitle}
                    </h2>
                    <p>{messages.discover.refineDescription}</p>
                  </div>
                  <IconButton
                    label={messages.discover.closeFilters}
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
                      label={messages.discover.sortBy}
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
                        (value) => (
                          <option key={value} value={value}>
                            {messages.discover.sort[value]}
                          </option>
                        ),
                      )}
                    </SelectField>
                    <SelectField
                      label={messages.discover.minimumVotes}
                      value={draft.voteCountMin}
                      hint={
                        draft.sort === HIGHEST_RATED_SORT
                          ? messages.discover.highestRatedVoteHint
                          : undefined
                      }
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          voteCountMin: event.target.value,
                        }))
                      }
                    >
                      {VOTE_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {value === "" && draft.sort === HIGHEST_RATED_SORT
                            ? messages.discover.defaultVotes({
                                count: HIGHEST_RATED_VOTE_FLOOR,
                              })
                            : voteLabel(value, messages)}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  <fieldset className="discover-genre-fieldset">
                    <legend>{messages.discover.genres}</legend>
                    <p>{messages.discover.matchAnyGenre}</p>
                    {genresQuery.isLoading ? (
                      <span className="discover-filter-loading">
                        {messages.discover.loadingGenres}
                      </span>
                    ) : null}
                    {genresQuery.isError ? (
                      <span className="discover-filter-warning">
                        {messages.discover.genresUnavailable}
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
                      <h3>{messages.discover.originAndLanguage}</h3>
                      <p>{messages.discover.originHint}</p>
                    </div>
                    <div className="discover-filter-grid">
                      <SelectField
                        label={messages.discover.originCountry}
                        value={draft.originCountry}
                        disabled={countriesQuery.isLoading}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            originCountry: event.target.value,
                          }))
                        }
                      >
                        <option value="">{messages.discover.anyCountry}</option>
                        {countries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.englishName}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label={messages.discover.originalLanguage}
                        value={draft.originalLanguage}
                        disabled={languagesQuery.isLoading}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            originalLanguage: event.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {messages.discover.anyLanguage}
                        </option>
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
                        {messages.discover.configUnavailable}
                      </p>
                    ) : null}
                  </div>

                  <div className="discover-filter-section">
                    <div className="discover-filter-section__heading">
                      <h3>{messages.discover.releaseWindow}</h3>
                      <p>{messages.discover.releaseWindowHint}</p>
                    </div>
                    <div className="discover-filter-grid discover-filter-grid--three">
                      <Field
                        label={messages.discover.exactYear}
                        type="number"
                        inputMode="numeric"
                        min={1874}
                        max={2200}
                        step={1}
                        placeholder={messages.discover.yearPlaceholder}
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
                        label={messages.discover.dateFrom}
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
                        label={messages.discover.dateTo}
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
                      <h3>{messages.discover.lengthAndQuality}</h3>
                      <p>{messages.discover.lengthHint}</p>
                    </div>
                    <div className="discover-filter-grid discover-filter-grid--three">
                      <SelectField
                        label={messages.discover.minimumLength}
                        value={draft.runtimeMin}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            runtimeMin: event.target.value,
                          }))
                        }
                      >
                        {RUNTIME_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {runtimeLabel(value, messages)}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label={messages.discover.maximumLength}
                        value={draft.runtimeMax}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            runtimeMax: event.target.value,
                          }))
                        }
                      >
                        {RUNTIME_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {runtimeLabel(value, messages)}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label={messages.discover.minimumRating}
                        value={draft.ratingMin}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ratingMin: event.target.value,
                          }))
                        }
                      >
                        {RATING_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {ratingLabel(value, messages)}
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
                          ? messages.discover.noActiveFilters
                          : messages.discover.activeFilters({
                              count: draftFilterCount,
                            })}
                      </p>
                    )}
                  </div>
                  <div className="discover-filter-menu__actions">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDraft(createDefaultDiscoverFilters())}
                    >
                      <RotateCcw size={16} aria-hidden="true" />{" "}
                      {messages.discover.reset}
                    </Button>
                    <Button
                      type="button"
                      disabled={Boolean(validationError)}
                      onClick={applyFilters}
                    >
                      {messages.discover.applyFilters}
                    </Button>
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>

      {activeFilters.length ? (
        <div
          className="discover-applied"
          aria-label={messages.discover.appliedFilters}
        >
          <span className="discover-applied__label">
            {messages.discover.applied}
          </span>
          <div className="discover-applied__chips">
            {activeFilters.map((filter) => (
              <span className="discover-filter-chip" key={filter.key}>
                {filter.label}
                <button
                  type="button"
                  aria-label={messages.discover.removeFilter({
                    label: filter.label,
                  })}
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
            {messages.discover.clearAll}
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
          title={messages.discover.emptyTitle}
          description={messages.discover.emptyDescription}
        />
      ) : null}
      {result?.items.length ? (
        <MediaGrid items={result.items} onSelect={setSelected} />
      ) : null}

      {result && result.totalPages > 1 ? (
        <nav className="pagination" aria-label={messages.discover.pages}>
          <IconButton
            label={messages.discover.previousPage}
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <ChevronLeft size={20} />
          </IconButton>
          <span>
            {messages.discover.pageOf({
              page: result.page,
              total: result.totalPages,
            })}
          </span>
          <IconButton
            label={messages.discover.nextPage}
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

export function discoverActorFromSearchParams(
  searchParams: URLSearchParams,
): { tmdbId: number; name: string } | undefined {
  const tmdbId = Number(searchParams.get("actorId"));
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return undefined;
  const suppliedName = (searchParams.get("actorName") ?? "").trim();
  return {
    tmdbId,
    name: suppliedName.slice(0, 200) || `TMDB person ${tmdbId}`,
  };
}

function clearActorSearchParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
): void {
  setSearchParams(
    (previous) => {
      const next = new URLSearchParams(previous);
      next.delete("actorId");
      next.delete("actorName");
      return next;
    },
    { replace: true },
  );
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
