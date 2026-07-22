import type { ReactNode } from "react";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component } from "react";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useRouteError,
} from "react-router";

import { api, ApiError } from "./api/client";
import { isAuthenticated, isSetupRequired } from "./api/normalize";
import { AppShell, RootLoading } from "./components/AppShell";
import { Brand } from "./components/Brand";
import { Button } from "./components/ui";
import { ActivityPage } from "./pages/ActivityPage";
import { LoginPage, SetupPage } from "./pages/AuthPages";
import { CalendarPage } from "./pages/CalendarPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        )
          return false;
        return failureCount < 2;
      },
    },
  },
});

function ProtectedApp() {
  const location = useLocation();
  const setupQuery = useQuery({
    queryKey: ["setup"],
    queryFn: ({ signal }) => api.get("setupStatus", { signal }),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
    retry: false,
  });

  if (setupQuery.isLoading || sessionQuery.isLoading) return <RootLoading />;
  if (isSetupRequired(setupQuery.data))
    return <Navigate to="/setup" replace state={{ from: location }} />;
  if (sessionQuery.isError || !isAuthenticated(sessionQuery.data))
    return <Navigate to="/login" replace state={{ from: location }} />;
  return <AppShell />;
}

function RouteError() {
  const error = useRouteError();
  const notFound = error instanceof Response && error.status === 404;
  let description = "The page could not be loaded.";
  if (notFound) description = "The page you requested doesn’t exist.";
  else if (error instanceof Error) description = error.message;
  return (
    <main className="route-error">
      <Brand />
      <span className="route-error__icon">
        <AlertTriangle size={28} />
      </span>
      <h1>{notFound ? "That page wandered off" : "Bobarr hit a snag"}</h1>
      <p>{description}</p>
      <a className="button button--primary button--md" href="/discover">
        Back to Discover
      </a>
    </main>
  );
}

const router = createBrowserRouter([
  { path: "/setup", element: <SetupPage />, errorElement: <RouteError /> },
  { path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: "/",
    element: <ProtectedApp />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/discover" replace /> },
      { path: "search", element: <SearchPage /> },
      { path: "discover", element: <DiscoverPage /> },
      { path: "suggestions", element: <SuggestionsPage /> },
      { path: "library", element: <Navigate to="/library/movies" replace /> },
      { path: "library/movies", element: <LibraryPage kind="movie" /> },
      { path: "library/shows", element: <LibraryPage kind="series" /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "*", element: <RouteError /> },
]);

interface AppErrorBoundaryState {
  error?: Error;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <main className="route-error">
          <Brand />
          <span className="route-error__icon">
            <AlertTriangle size={28} />
          </span>
          <h1>The interface stopped unexpectedly</h1>
          <p>{this.state.error.message}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            <RotateCcw size={17} /> Reload Bobarr
          </Button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
