import type { Session } from "../types";
import type { Messages } from "./en";
import type { ReactNode } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  NATIVE_LOCALE_NAMES,
  UI_LOCALES,
  catalogs,
  clearPendingLocale,
  hasPendingLocale,
  localeAfterAuth,
  parseUiLocale,
  readGuestLocale,
  rememberGuestLocale,
  resolveUiLocale,
  type UiLocale,
  writeGuestLocale,
  markPendingLocale,
} from "./locale";
import { api } from "../api/client";
import { isAuthenticated } from "../api/normalize";

export interface UiContextValue {
  locale: UiLocale;
  messages: Messages;
  setLocale: (locale: UiLocale) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const value = useContext(UiContext);
  if (value === null) {
    throw new Error("useUi must be used within UiProvider");
  }
  return value;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
    retry: false,
  });
  const authenticated = isAuthenticated(sessionQuery.data);
  const profileLocale = sessionQuery.data?.user?.uiLocale;
  const [guestLocale, setGuestLocale] = useState<UiLocale | null>(() =>
    readGuestLocale(),
  );
  const navigatorLanguage =
    typeof navigator === "undefined" ? undefined : navigator.language;
  const locale = resolveUiLocale({
    user: authenticated ? profileLocale : null,
    guest: guestLocale,
    navigator: navigatorLanguage,
  });
  const lastAuthedLocale = useRef(locale);
  const wasAuthenticated = useRef(false);
  const adoptedKey = useRef<string | null>(null);

  if (authenticated) lastAuthedLocale.current = locale;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const persistLocale = useMutation({
    mutationFn: (uiLocale: UiLocale) =>
      api.patch("updateUiLocale", { body: { uiLocale } }),
    onSuccess: (account) => {
      queryClient.setQueryData(
        ["auth", "session"],
        (current: Session | undefined) => {
          if (current === undefined) return { user: account };
          return { ...current, user: { ...current.user, ...account } };
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });

  useEffect(() => {
    if (wasAuthenticated.current && !authenticated) {
      rememberGuestLocale(lastAuthedLocale.current);
      setGuestLocale(lastAuthedLocale.current);
      adoptedKey.current = null;
    }
    wasAuthenticated.current = authenticated;
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !sessionQuery.isFetched) return;
    const decision = localeAfterAuth({
      user: profileLocale,
      guest: guestLocale ?? readGuestLocale(),
      navigator: navigatorLanguage,
      pending: hasPendingLocale(),
    });
    if (!decision.shouldPersist) {
      clearPendingLocale();
      return;
    }
    const key = `${sessionQuery.data?.user?.id ?? "session"}:${decision.locale}`;
    if (adoptedKey.current === key) return;
    adoptedKey.current = key;
    clearPendingLocale();
    persistLocale.mutate(decision.locale);
  }, [
    authenticated,
    guestLocale,
    navigatorLanguage,
    persistLocale,
    profileLocale,
    sessionQuery.data?.user?.id,
    sessionQuery.isFetched,
  ]);

  const setLocale = (next: UiLocale) => {
    if (next === locale) return;
    writeGuestLocale(next);
    markPendingLocale();
    setGuestLocale(next);
    if (authenticated) persistLocale.mutate(next);
  };

  return (
    <UiContext.Provider
      value={{ locale, messages: catalogs[locale], setLocale }}
    >
      {children}
    </UiContext.Provider>
  );
}

export function LocaleSwitcher({ labeled = false }: { labeled?: boolean }) {
  const { locale, messages, setLocale } = useUi();
  const select = (
    <span className="select-control">
      <select
        aria-label={labeled ? undefined : messages.locale.label}
        value={locale}
        onChange={(event) => {
          const next = parseUiLocale(event.currentTarget.value);
          if (next === null) return;
          setLocale(next);
        }}
      >
        {UI_LOCALES.map((value) => (
          <option key={value} value={value}>
            {NATIVE_LOCALE_NAMES[value]}
          </option>
        ))}
      </select>
      <ChevronDown
        className="select-control__icon"
        aria-hidden="true"
        size={18}
        strokeWidth={2}
      />
    </span>
  );
  if (labeled) {
    return (
      <label className="compact-select">
        <span>{messages.locale.label}</span>
        {select}
      </label>
    );
  }
  return <label className="compact-select">{select}</label>;
}
