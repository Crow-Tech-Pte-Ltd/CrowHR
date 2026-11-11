import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { useDocumentTitle } from "../shell/document-title.ts";
import { ViewModeProvider } from "../shell/view-mode.tsx";

function Root() {
  useDocumentTitle();
  return (
    <ViewModeProvider>
      <Outlet />
    </ViewModeProvider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});
