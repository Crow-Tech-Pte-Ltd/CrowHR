import { createFileRoute } from "@tanstack/react-router";
import { SetupWizard } from "../setup/setup-wizard.tsx";

// Outside the `_app` shell: there is no organisation or session yet. The server redirects every
// other page here until setup is complete, and the API answers 404 afterwards.
export const Route = createFileRoute("/setup")({
  component: SetupWizard,
});
