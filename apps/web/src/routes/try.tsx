import { createFileRoute } from "@tanstack/react-router";
import { TryPage } from "../demo-company/try-page.tsx";

// Outside the `_app` shell: public, no session. Only a server with DEMO_COMPANIES=1 offers it; the
// page asks the server and shows "Page not found" otherwise.
export const Route = createFileRoute("/try")({
  component: TryPage,
});
