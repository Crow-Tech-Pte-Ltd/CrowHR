import { EmptyState } from "@crowhr/ui";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "../../../../components/page-header.tsx";

// NOT IMPLEMENTED: placeholder. The auth workstream builds per-organisation
// sign-in method configuration (one OIDC implementation with provider presets).
export const Route = createFileRoute("/_app/settings/security/sign-in-methods")({
  component: SignInMethodsPage,
});

function SignInMethodsPage() {
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }, { label: "Security" }]}
        title="Sign-in methods"
        description="Choose how people in your organisation sign in. Only the methods you enable appear on the sign-in page."
      />
      <EmptyState
        data-testid="module-empty-state"
        icon={<ShieldCheck />}
        title="Configure Google, Microsoft, Singpass or OIDC"
        description={
          <>
            Connect Google Workspace, Microsoft Entra ID, Singpass or any OpenID Connect provider such as Okta or
            Keycloak. Email and password stays available to the organisation owner as a break-glass sign-in. Singpass
            needs your company to be onboarded as a Singpass relying party first.
          </>
        }
        note="Sign-in methods are not available yet"
      />
    </>
  );
}
