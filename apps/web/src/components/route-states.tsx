import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Skeleton } from "@crowhr/ui";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, Compass } from "lucide-react";

export function RoutePending() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-4 py-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Alert variant="danger" className="max-w-xl">
      <AlertTriangle aria-hidden />
      <div className="flex flex-col gap-2">
        <AlertTitle>This page failed to load</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "An unexpected error occurred."} Try again; if it keeps happening,
          tell your administrator.
        </AlertDescription>
        <div>
          <Button
            size="sm"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    </Alert>
  );
}

export function RouteNotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      description="The address may be mistyped, or the page has moved."
      actions={
        <Button asChild size="sm">
          <Link to="/">Go to Home</Link>
        </Button>
      }
    />
  );
}
