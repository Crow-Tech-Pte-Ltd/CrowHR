import { Alert, AlertDescription, AlertTitle, Button } from "@crowhr/ui";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { meQuery } from "../auth/session.ts";
import type { SignInMethods } from "../auth/types.ts";
import { RoutePending } from "../components/route-states.tsx";
import { DemoCompanyEndedPage } from "../demo-company/notices.tsx";
import { ApiError, apiGet } from "../lib/api.ts";
import { noticeFor, SignInPage } from "../sign-in/sign-in-page.tsx";

type Search = {
  mfa?: string;
  native?: string;
  reason?: string;
  error?: string;
  provider?: string;
  reset?: string;
  singpass?: string;
};

export const Route = createFileRoute("/sign-in/$org")({
  validateSearch: (s: Record<string, unknown>): Search =>
    Object.fromEntries(
      Object.entries(s).filter(
        ([k, v]) =>
          ["mfa", "native", "reason", "error", "provider", "reset", "singpass"].includes(k) && typeof v === "string",
      ),
    ) as Search,
  beforeLoad: async ({ context, search }) => {
    if (search.mfa || search.native || search.reason || search.error || search.singpass) return;
    // Already signed in: go home instead of showing the form.
    const me = await context.queryClient.fetchQuery(meQuery).catch(() => null);
    if (me) throw redirect({ to: "/" });
  },
  loader: ({ params }) => apiGet<SignInMethods>(`/api/v1/auth/methods?org=${encodeURIComponent(params.org)}`),
  pendingComponent: () => (
    <div className="mx-auto max-w-sm p-10">
      <RoutePending />
    </div>
  ),
  errorComponent: ({ error }) =>
    error instanceof ApiError &&
    (error.envelope?.error.details as { demoCompanyEnded?: boolean } | undefined)?.demoCompanyEnded ? (
      <DemoCompanyEndedPage message={error.message} />
    ) : (
      <AuthLayout title="Can't show the sign-in page">
        <Alert variant="danger">
          <AlertTriangle aria-hidden />
          <div>
            <AlertTitle>
              {error instanceof ApiError && error.status === 404 ? "Organisation not found" : "Something went wrong"}
            </AlertTitle>
            <AlertDescription>
              {error instanceof ApiError && error.status === 404
                ? `${error.message}`
                : "The server didn't answer. Check your connection and try again."}
            </AlertDescription>
          </div>
        </Alert>
        <Button asChild variant="secondary" className="mt-4 self-start">
          <Link to="/sign-in">Choose another organisation</Link>
        </Button>
      </AuthLayout>
    ),
  component: SignInRoute,
});

function SignInRoute() {
  const methods = Route.useLoaderData();
  const { org } = Route.useParams();
  const search = Route.useSearch();
  return (
    <SignInPage
      key={org}
      methods={methods}
      orgSlug={org}
      nativeRequestId={search.native}
      ssoMfaPending={search.mfa === "1"}
      demoSingpassOk={search.singpass === "ok"}
      initialNotice={noticeFor(search, methods.organisation?.name ?? org)}
    />
  );
}
