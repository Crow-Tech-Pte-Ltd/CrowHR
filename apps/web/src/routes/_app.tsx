import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "../shell/app-shell.tsx";

// Pathless layout: every signed-in screen renders inside the shell.
// NOT IMPLEMENTED: no auth guard yet (auth workstream adds `beforeLoad`).
export const Route = createFileRoute("/_app")({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
