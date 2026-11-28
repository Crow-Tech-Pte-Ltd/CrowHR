import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Skeleton } from "@crowhr/ui";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { useT } from "../i18n/index.ts";
import { reportError } from "../monitoring.ts";

export function RoutePending() {
  const t = useT("common");
  return (
    <div role="status" aria-busy="true" aria-label={t("Loading")} className="flex flex-col gap-4 py-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const t = useT("common");
  const router = useRouter();
  useEffect(() => reportError(error), [error]);
  return (
    <Alert variant="danger" className="max-w-xl">
      <AlertTriangle aria-hidden />
      <div className="flex flex-col gap-2">
        <AlertTitle>{t("This page failed to load")}</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : t("An unexpected error occurred.")}{" "}
          {t("Try again. If it keeps happening, tell your administrator.")}
        </AlertDescription>
        <div>
          <Button
            size="sm"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            {t("Try again")}
          </Button>
        </div>
      </div>
    </Alert>
  );
}

export function RouteNotFound() {
  const t = useT("common");
  return (
    <EmptyState
      title={t("Page not found.")}
      description={t("The address may be mistyped, or the page has moved.")}
      actions={
        <Button asChild size="sm">
          <Link to="/">{t("Go to Home")}</Link>
        </Button>
      }
    />
  );
}
