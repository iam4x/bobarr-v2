import type { Messages } from "../i18n/en";
import type { SystemStatus } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  Compass,
  Film,
  Library,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  Tv,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Brand } from "./Brand";
import { ModalLayer } from "./ModalLayer";
import { Badge, Button, classNames, IconButton } from "./ui";
import { api } from "../api/client";
import { normalizeSystemStatus } from "../api/normalize";
import { useServerEvents } from "../hooks/useServerEvents";
import { LocaleSwitcher, useUi } from "../i18n/ui";

interface NavigationItem {
  label: string;
  to: string;
  icon: typeof Search;
  end?: boolean;
}

function navigationItems(messages: Messages) {
  const primaryNavigation: NavigationItem[] = [
    { label: messages.nav.discover, to: "/discover", icon: Compass },
    { label: messages.nav.search, to: "/search", icon: Search },
    { label: messages.nav.suggestions, to: "/suggestions", icon: Sparkles },
  ];
  const libraryNavigation: NavigationItem[] = [
    { label: messages.nav.movies, to: "/library/movies", icon: Film },
    { label: messages.nav.shows, to: "/library/shows", icon: Tv },
    { label: messages.nav.calendar, to: "/calendar", icon: CalendarDays },
  ];
  const activityNavigation: NavigationItem = {
    label: messages.nav.activity,
    to: "/activity",
    icon: Activity,
  };
  const settingsNavigation: NavigationItem = {
    label: messages.nav.settings,
    to: "/settings",
    icon: Settings,
  };
  const accountNavigation: NavigationItem = {
    label: messages.nav.account,
    to: "/account",
    icon: UserRound,
  };
  return {
    primaryNavigation,
    libraryNavigation,
    activityNavigation,
    settingsNavigation,
    accountNavigation,
  };
}

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

function StatusPill({
  status,
  to,
  labels,
}: {
  status?: SystemStatus;
  to: string;
  labels: {
    ready: string;
    degraded: string;
    unavailable: string;
  };
}) {
  let tone = "danger";
  let label = labels.unavailable;
  if (status?.status === "ready") {
    tone = "success";
    label = labels.ready;
  } else if (status?.status === "degraded") {
    tone = "warning";
    label = labels.degraded;
  }
  return (
    <NavLink className="service-pill" to={to} title={label}>
      <span
        className={classNames("status-dot", `status-dot--${tone}`)}
        aria-hidden="true"
      />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const { messages } = useUi();
  const {
    primaryNavigation,
    libraryNavigation,
    activityNavigation,
    settingsNavigation,
    accountNavigation,
  } = navigationItems(messages);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const canManageSettings =
    sessionQuery.data?.capabilities?.canManageSettings === true;
  const systemNavigation: NavigationItem[] = canManageSettings
    ? [activityNavigation, settingsNavigation, accountNavigation]
    : [activityNavigation, accountNavigation];
  const logoutMutation = useMutation({
    mutationFn: () => api.post("logout"),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
  const statusQuery = useQuery({
    queryKey: ["system", "status"],
    queryFn: async ({ signal }) =>
      normalizeSystemStatus(await api.get("systemStatus", { signal })),
    retry: 1,
    refetchInterval: 30_000,
  });
  useServerEvents();

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  const mobileItems: NavigationItem[] = [
    { label: messages.nav.discover, to: "/discover", icon: Compass },
    { label: messages.nav.search, to: "/search", icon: Search },
    { label: messages.nav.library, to: "/library/movies", icon: Library },
    { label: messages.nav.activity, to: "/activity", icon: Activity },
  ];
  const statusLabels = {
    ready: messages.nav.statusReady,
    degraded: messages.nav.statusDegraded,
    unavailable: messages.nav.statusUnavailable,
  };

  return (
    <div className="app-shell">
      <aside className="nav-rail" data-desktop-navigation>
        <NavLink className="nav-rail__brand" to="/discover">
          <Brand />
        </NavLink>

        <nav aria-label={messages.nav.main}>
          <div className="nav-group">
            <span className="nav-group__label">{messages.nav.browse}</span>
            {primaryNavigation.map((item) => (
              <DesktopNavLink item={item} key={item.to} />
            ))}
          </div>
          <div className="nav-group">
            <span className="nav-group__label">{messages.nav.library}</span>
            {libraryNavigation.map((item) => (
              <DesktopNavLink item={item} key={item.to} />
            ))}
          </div>
          <div className="nav-group">
            <span className="nav-group__label">{messages.nav.system}</span>
            {systemNavigation.map((item) => (
              <DesktopNavLink item={item} key={item.to} />
            ))}
          </div>
        </nav>

        <div className="nav-rail__footer">
          <StatusPill
            status={statusQuery.data}
            to={canManageSettings ? "/settings#connections" : "/discover"}
            labels={statusLabels}
          />
          <LocaleSwitcher />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            busy={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            <LogOut size={15} /> {messages.nav.signOut}
          </Button>
          <span className="version-label">{messages.nav.version}</span>
        </div>
      </aside>

      <header className="mobile-header">
        <NavLink to="/discover">
          <Brand />
        </NavLink>
        {statusQuery.data?.status === "degraded" ? (
          <Badge tone="warning">{messages.nav.degraded}</Badge>
        ) : null}
      </header>

      <div className="app-content">
        {statusQuery.isError ? (
          <div className="connection-banner" role="status">
            <span
              className="status-dot status-dot--danger"
              aria-hidden="true"
            />
            {messages.nav.offline}
          </div>
        ) : null}
        <Outlet />
      </div>

      <nav
        className="mobile-nav"
        aria-label={messages.nav.mobile}
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
          <span>{messages.nav.more}</span>
        </button>
      </nav>

      <ModalLayer
        open={moreOpen}
        onDismiss={() => setMoreOpen(false)}
        returnFocusRef={moreButtonRef}
        surfaceId="mobile-more-menu"
        labelledBy="mobile-more-title"
        backdropClassName="mobile-sheet-backdrop"
        surfaceClassName="mobile-sheet"
        sheet={{ kind: "drag-handle", availability: "always" }}
      >
        <header>
          <div>
            <span className="eyebrow">{messages.nav.moreEyebrow}</span>
            <h2 id="mobile-more-title">{messages.nav.moreTitle}</h2>
          </div>
          <IconButton
            label={messages.nav.closeMenu}
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
        <StatusPill
          status={statusQuery.data}
          to={canManageSettings ? "/settings#connections" : "/discover"}
          labels={statusLabels}
        />
        <LocaleSwitcher labeled />
        <Button
          type="button"
          variant="ghost"
          busy={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut size={16} /> {messages.nav.signOut}
        </Button>
      </ModalLayer>
    </div>
  );
}

export function RootLoading() {
  const { messages } = useUi();
  return (
    <main className="full-page-state" aria-busy="true">
      <Brand />
      <Clapperboard className="spin-slow" size={28} aria-hidden="true" />
      <p>{messages.nav.warmingUp}</p>
    </main>
  );
}
