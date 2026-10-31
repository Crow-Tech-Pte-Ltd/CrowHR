import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ViewModeProvider } from "../shell/view-mode.tsx";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <ViewModeProvider>
      <Outlet />
    </ViewModeProvider>
  ),
});
