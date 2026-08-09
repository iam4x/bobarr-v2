import type { SystemStatus } from "../types";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  Compass,
  Film,
  Library,
  Menu,
  Search,
  Settings,
  Sparkles,
  Tv,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

import { Brand } from "./Brand";
import { Badge, classNames, IconButton } from "./ui";
import { api } from "../api/client";
import { normalizeSystemStatus } from "../api/normalize";
import { useServerEvents } from "../hooks/useServerEvents";

interface NavigationItem {
  label: string;
  to: string;
  icon: typeof Search;
  end?: boolean;
}

const primaryNavigation: NavigationItem[] = [
  { label: "Discover", to: "/discover", icon: Compass },
  { label: "Search", to: "/search", icon: Search },
  { label: "Suggestions", to: "/suggestions", icon: Sparkles },
];

const libraryNavigation: NavigationItem[] = [
  { label: "Movies", to: "/library/movies", icon: Film },
  { label: "Shows", to: "/library/shows", icon: Tv },
  { label: "Calendar", to: "/calendar", icon: CalendarDays },
];

const systemNavigation: NavigationItem[] = [
  { label: "Activity", to: "/activity", icon: Activity },
  { label: "Settings", to: "/settings", icon: Settings },
];

function DesktopNavLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        classNames("rail-link", isActive && "is-active")
      }
    >
      <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function StatusPill({ status }: { status?: SystemStatus }) {
  let tone = "danger";
  let label = "Service unavailable";
  if (status?.status === "ready") {
    tone = "success";
    label = "All systems ready";
  } else if (status?.status === "degraded") {
    tone = "warning";
    label = "Service degraded";
  }
  return (
    <NavLink className="service-pill" to="/settings#connections" title={label}>
      <span
        className={classNames("status-dot", `status-dot--${tone}`)}
        aria-hidden="true"
      />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const statusQuery = useQuery({
    queryKey: ["system", "status"],
    queryFn: async ({ signal }) =>
      normalizeSystemStatus(await api.get("systemStatus", { signal })),
    retry: 1,
    refetchInterval: 30_000,
  });
  useServerEvents();

  useEffect(() => setMoreOpen(false), [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sheetFocusableElements(moreSheetRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        moreSheetRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = requestAnimationFrame(() => {
      sheetFocusableElements(moreSheetRef.current)[0]?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      moreButtonRef.current?.focus();
    };
  }, [moreOpen]);

  const mobileItems: NavigationItem[] = [
    { label: "Discover", to: "/discover", icon: Compass },
    { label: "Search", to: "/search", icon: Search },
    { label: "Library", to: "/library/movies", icon: Library },
    { label: "Activity", to: "/activity", icon: Activity },
  ];

  return (
    <div className="app-shell">
      <aside className="nav-rail" data-desktop-navigation>
        <NavLink className="nav-rail__brand" to="/discover">
          <Brand />
        </NavLink>

        <nav aria-label="Main navigation">
          <div className="nav-group">
            <span className="nav-group__label">Browse</span>
            {primaryNavigation.map((item) => (
              <DesktopNavLink item={item} key={item.to} />
            ))}
          </div>
          <div className="nav-group">
            <span className="nav-group__label">Library</span>
            {libraryNavigation.map((item) => (
              <DesktopNavLink item={item} key={item.to} />
            ))}
          </div>
          <div className="nav-group">
            <span className="nav-group__label">System</span>
            {systemNavigation.map((item) => (
              <DesktopNavLink item={item} key={item.to} />
            ))}
          </div>
        </nav>

        <div className="nav-rail__footer">
          <StatusPill status={statusQuery.data} />
          <span className="version-label">Bobarr v2</span>
        </div>
      </aside>

      <header className="mobile-header">
        <NavLink to="/discover">
          <Brand />
        </NavLink>
        {statusQuery.data?.status === "degraded" ? (
          <Badge tone="warning">Degraded</Badge>
        ) : null}
      </header>

      <div className="app-content">
        {statusQuery.isError ? (
          <div className="connection-banner" role="status">
            <span
              className="status-dot status-dot--danger"
              aria-hidden="true"
            />
            Bobarr is offline. We’ll keep trying to reconnect.
          </div>
        ) : null}
        <Outlet />
      </div>

      <nav
        className="mobile-nav"
        aria-label="Mobile navigation"
        data-mobile-navigation
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                classNames("mobile-nav__link", isActive && "is-active")
              }
            >
              <Icon size={21} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className={classNames("mobile-nav__link", moreOpen && "is-active")}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMoreOpen((value) => !value)}
        >
          <Menu size={21} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="mobile-sheet-backdrop"
          role="presentation"
          onMouseDown={() => setMoreOpen(false)}
        >
          <section
            ref={moreSheetRef}
            id="mobile-more-menu"
            className="mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">Navigation</span>
                <h2 id="mobile-more-title">More from Bobarr</h2>
              </div>
              <IconButton
                label="Close menu"
                autoFocus
                onClick={() => setMoreOpen(false)}
              >
                <X size={20} />
              </IconButton>
            </header>
            <nav>
              {[
                ...primaryNavigation.slice(2),
                ...libraryNavigation,
                ...systemNavigation.slice(1),
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to}>
                    <span className="mobile-sheet__icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span>{item.label}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </NavLink>
                );
              })}
            </nav>
            <StatusPill status={statusQuery.data} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function RootLoading() {
  return (
    <main className="full-page-state" aria-busy="true">
      <Brand />
      <Clapperboard className="spin-slow" size={28} aria-hidden="true" />
      <p>Warming up your library…</p>
    </main>
  );
}

function sheetFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}
