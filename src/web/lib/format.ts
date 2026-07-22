import type { CatalogItem } from "../types";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export function imageUrl(
  path: string | null | undefined,
  size: "w342" | "w500" | "w780" | "original" = "w500",
): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${TMDB_IMAGE_BASE}/${size}/${path.replace(/^\//, "")}`;
}

export function mediaYear(
  item: Pick<CatalogItem, "year" | "releaseDate">,
): string {
  if (item.year) return String(item.year);
  if (!item.releaseDate) return "TBA";
  const year = new Date(item.releaseDate).getUTCFullYear();
  return Number.isNaN(year) ? "TBA" : String(year);
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1_000) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_000;
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex += 1;
  }
  let digits = 2;
  if (value >= 100) digits = 0;
  else if (value >= 10) digits = 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatRate(bytesPerSecond?: number): string {
  return bytesPerSecond === undefined
    ? "—"
    : `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds?: number | null): string {
  if (
    seconds === undefined ||
    seconds === null ||
    seconds < 0 ||
    !Number.isFinite(seconds)
  ) {
    return "—";
  }
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatDate(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(
    undefined,
    options ?? { dateStyle: "medium" },
  ).format(date);
}

export function formatRelativeDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60)
    return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function toPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const normalized = progress > 1 ? progress : progress * 100;
  return Math.min(100, Math.max(0, Math.round(normalized)));
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
