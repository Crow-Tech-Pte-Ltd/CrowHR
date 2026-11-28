import { Button, FormField, Input } from "@crowhr/ui";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { rememberedOrg } from "../auth/session.ts";
import type { SignInMethods } from "../auth/types.ts";
import { useT } from "../i18n/index.ts";
import { apiGet } from "../lib/api.ts";

type Search = { native?: string; reason?: string; error?: string; provider?: string; reset?: string };

/** `/sign-in`: the only organisation of a one-org install, otherwise ask which organisation. */
export const Route = createFileRoute("/sign-in/")({
  validateSearch: (s: Record<string, unknown>): Search =>
    Object.fromEntries(
      Object.entries(s).filter(
        ([k, v]) => ["native", "reason", "error", "provider", "reset"].includes(k) && typeof v === "string",
      ),
    ) as Search,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const methods = await apiGet<SignInMethods>("/api/v1/auth/methods");
    // One-org install: that org. Several: the one last signed in to on this browser, if any.
    const slug = methods.organisation?.slug ?? rememberedOrg();
    if (slug) throw redirect({ to: "/sign-in/$org", params: { org: slug }, search: deps });
    return methods;
  },
  component: ChooseOrganisation,
});

function ChooseOrganisation() {
  const t = useT("settings-account");
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [slug, setSlug] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  return (
    <AuthLayout
      title={t("Which organisation?")}
      description={t(
        "This server hosts more than one organisation. Enter the one you belong to; it's in the sign-in link your HR team sent.",
      )}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = slug
            .trim()
            .toLowerCase()
            .replace(/^.*\/sign-in\//, "");
          if (!/^[a-z0-9-]+$/.test(clean)) {
            setError(t("Use the short name from your sign-in link, like kampong-kopi (letters, numbers and hyphens)."));
            return;
          }
          void navigate({ to: "/sign-in/$org", params: { org: clean }, search });
        }}
      >
        <FormField label={t("Organisation")} error={error} hint={t("For example kampong-kopi.")}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} autoFocus autoCapitalize="none" />
        </FormField>
        <Button type="submit" variant="primary" size="lg">
          {t("Continue")}
        </Button>
      </form>
    </AuthLayout>
  );
}
