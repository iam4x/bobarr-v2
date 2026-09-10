import { afterEach, describe, expect, test } from "bun:test";

import {
  GUEST_LOCALE_KEY,
  PENDING_LOCALE_KEY,
  clearPendingLocale,
  hasPendingLocale,
  localeAfterAuth,
  markPendingLocale,
  parseUiLocale,
  readGuestLocale,
  rememberGuestLocale,
  resolveUiLocale,
  writeGuestLocale,
} from "./locale";

const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: originalSessionStorage,
  });
});

describe("parseUiLocale", () => {
  test("rejects junk", () => {
    expect(parseUiLocale(undefined)).toBeNull();
    expect(parseUiLocale(null)).toBeNull();
    expect(parseUiLocale(1)).toBeNull();
    expect(parseUiLocale("")).toBeNull();
    expect(parseUiLocale("de")).toBeNull();
    expect(parseUiLocale("french")).toBeNull();
    expect(parseUiLocale("en-GB-x-custom")).toBe("en");
  });

  test("maps a BCP-47 primary subtag onto en or fr", () => {
    expect(parseUiLocale("en")).toBe("en");
    expect(parseUiLocale("fr")).toBe("fr");
    expect(parseUiLocale("fr-FR")).toBe("fr");
    expect(parseUiLocale("fr_CA")).toBe("fr");
    expect(parseUiLocale("EN-US")).toBe("en");
    expect(parseUiLocale(" FR ")).toBe("fr");
  });
});

describe("resolveUiLocale", () => {
  test("prefers a valid profile, then guest, then navigator, then English", () => {
    expect(
      resolveUiLocale({
        user: "fr",
        guest: "en",
        navigator: "en-US",
      }),
    ).toBe("fr");
    expect(
      resolveUiLocale({
        user: "de",
        guest: "fr",
        navigator: "en-US",
      }),
    ).toBe("fr");
    expect(
      resolveUiLocale({
        user: null,
        guest: "not-a-locale",
        navigator: "fr-FR",
      }),
    ).toBe("fr");
    expect(
      resolveUiLocale({
        user: null,
        guest: null,
        navigator: "de-DE",
      }),
    ).toBe("en");
  });
});

describe("localeAfterAuth", () => {
  test("pending guest choice is persisted even when a profile locale exists", () => {
    expect(
      localeAfterAuth({
        user: "en",
        guest: "fr",
        navigator: "en-US",
        pending: true,
      }),
    ).toEqual({ locale: "fr", shouldPersist: true });
  });

  test("a null profile adopts guest then navigator", () => {
    expect(
      localeAfterAuth({
        user: null,
        guest: null,
        navigator: "fr-FR",
        pending: false,
      }),
    ).toEqual({ locale: "fr", shouldPersist: true });
    expect(
      localeAfterAuth({
        user: null,
        guest: "en",
        navigator: "fr-FR",
        pending: false,
      }),
    ).toEqual({ locale: "en", shouldPersist: true });
  });

  test("a set profile wins over leftover guest storage", () => {
    expect(
      localeAfterAuth({
        user: "en",
        guest: "fr",
        navigator: "fr-FR",
        pending: false,
      }),
    ).toEqual({ locale: "en", shouldPersist: false });
  });
});

describe("guest and pending storage", () => {
  test("writes guest locale and pending independently", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: local,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: session,
    });

    writeGuestLocale("fr");
    expect(local.getItem(GUEST_LOCALE_KEY)).toBe("fr");
    expect(readGuestLocale()).toBe("fr");

    markPendingLocale();
    expect(session.getItem(PENDING_LOCALE_KEY)).toBe("1");
    expect(hasPendingLocale()).toBe(true);

    rememberGuestLocale("en");
    expect(readGuestLocale()).toBe("en");
    expect(hasPendingLocale()).toBe(false);
    expect(session.getItem(PENDING_LOCALE_KEY)).toBeNull();

    markPendingLocale();
    clearPendingLocale();
    expect(hasPendingLocale()).toBe(false);
  });
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}
