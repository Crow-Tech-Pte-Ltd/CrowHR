import "@crowhr/ui/fonts.css";
import "@crowhr/ui/styles.css";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reasonFor } from "./auth/session.ts";
import { RouteError, RouteNotFound, RoutePending } from "./components/route-states.tsx";
import { ApiError } from "./lib/api.ts";
import { readMonitoringConfig, rootErrorOptions, startMonitoring } from "./monitoring.ts";
import { routeTree } from "./routeTree.gen.ts";

/** A session that expires or is revoked mid-use sends the user to sign-in with the reason. */
function onAuthLost(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  if (window.location.pathname.startsWith("/sign-in")) return;
  const reason = reasonFor(err);
  queryClient.clear();
  void router.navigate({ to: "/sign-in", search: reason ? { reason } : {} });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthLost }),
  mutationCache: new MutationCache({ onError: onAuthLost }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Only when the server enabled browser error reporting (SENTRY_BROWSER_DSN): load the SDK first,
// so errors during the first render are reported too. Otherwise nothing is loaded.
const monitoring = readMonitoringConfig();
if (monitoring) await startMonitoring(monitoring, router);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root, rootErrorOptions()).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
