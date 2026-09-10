import { en, type Messages } from "./en";
import { fr } from "./fr";
import { type UiLocale, UiLocaleSchema } from "../../contracts/auth";

export type { Messages, UiLocale };

export const UI_LOCALES = UiLocaleSchema.options;

export const catalogs: Record<UiLocale, Messages> = { en, fr };

export const DEFAULT_UI_LOCALE: UiLocale = "en";

export const GUEST_LOCALE_KEY = "bobarr.uiLocale";
export const PENDING_LOCALE_KEY = "bobarr.uiLocale.pending";

export const NATIVE_LOCALE_NAMES: Record<UiLocale, string> = {
  en: "English",
  fr: "Français",
};

export function parseUiLocale(value: unknown): UiLocale | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "en" || trimmed === "fr") return trimmed;
  const primary = trimmed.toLowerCase().split(/[-_]/)[0];
  if (primary === "en" || primary === "fr") return primary;
  return null;
}

export function resolveUiLocale(sources: {
  user?: unknown;
  guest?: unknown;
  navigator?: unknown;
}): UiLocale {
  return (
    parseUiLocale(sources.user) ??
    parseUiLocale(sources.guest) ??
    parseUiLocale(sources.navigator) ??
    DEFAULT_UI_LOCALE
  );
}

export function localeAfterAuth(sources: {
  user?: unknown;
  guest?: unknown;
  navigator?: unknown;
  pending: boolean;
}): { locale: UiLocale; shouldPersist: boolean } {
  const profile = parseUiLocale(sources.user);
  if (sources.pending || profile === null) {
    return {
      locale: resolveUiLocale({
        guest: sources.guest,
        navigator: sources.navigator,
      }),
      shouldPersist: true,
    };
  }
  return { locale: profile, shouldPersist: false };
}

export function readGuestLocale(): UiLocale | null {
  return parseUiLocale(readStorage(localStorageRef(), GUEST_LOCALE_KEY));
}

export function writeGuestLocale(locale: UiLocale): void {
  writeStorage(localStorageRef(), GUEST_LOCALE_KEY, locale);
}

export function rememberGuestLocale(locale: UiLocale): void {
  writeGuestLocale(locale);
  clearPendingLocale();
}

export function markPendingLocale(): void {
  writeStorage(sessionStorageRef(), PENDING_LOCALE_KEY, "1");
}

export function hasPendingLocale(): boolean {
  return readStorage(sessionStorageRef(), PENDING_LOCALE_KEY) === "1";
}

export function clearPendingLocale(): void {
  removeStorage(sessionStorageRef(), PENDING_LOCALE_KEY);
}

function localStorageRef(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function sessionStorageRef(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function readStorage(storage: Storage | undefined, key: string): string | null {
  if (storage === undefined) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(
  storage: Storage | undefined,
  key: string,
  value: string,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(key, value);
  } catch {
    return;
  }
}

function removeStorage(storage: Storage | undefined, key: string): void {
  if (storage === undefined) return;
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}
