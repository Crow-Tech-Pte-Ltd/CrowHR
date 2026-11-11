import { Button, EmptyState } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { ApiError } from "../lib/api.ts";
import { type Crumb, PageHeader } from "./page-header.tsx";

/** True for a 404 from the API: the record doesn't exist, or this member may not see it. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * A record page whose record is missing: a real page title and a way back, rather than an error
 * with a "Try again" that can't help.
 */
export function NotFoundPage({
  title,
  crumbs,
  back,
}: {
  title: string;
  crumbs: Crumb[];
  back: { to: string; label: string };
}) {
  return (
    <>
      <PageHeader crumbs={crumbs} title={title} />
      <EmptyState
        icon={<SearchX />}
        title="Nothing here"
        description="It doesn't exist, or your role can't see it. Check the link, or find it from the list."
        actions={
          <Button asChild size="sm">
            <Link to={back.to}>{back.label}</Link>
          </Button>
        }
      />
    </>
  );
}
