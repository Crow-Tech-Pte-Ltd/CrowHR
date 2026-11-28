import { Card, textStyle } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { requestReference } from "../help/diagnostics.ts";
import { ApiError } from "../lib/api.ts";

/** A titled settings section: heading + one-line description + content card. */
export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className="mb-8">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className={textStyle.section}>
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-2xl text-ui text-primary-300">{description}</p> : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      <Card>{children}</Card>
    </section>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  // Retrying a 404 can't help.
  const gone = error instanceof ApiError && error.status === 404;
  const topic =
    error instanceof ApiError && error.status >= 500
      ? "service"
      : error instanceof ApiError && error.code === "forbidden"
        ? "permissions"
        : null;
  const reference = error instanceof ApiError ? requestReference(error.envelope?.error.requestId) : undefined;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 p-4 text-ui text-danger-300 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        {error instanceof Error ? error.message : "This didn't load."}
        {gone || topic ? null : " Try again. If it keeps failing, tell your administrator."}
      </span>
      {(retry && !gone) || topic ? (
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-2">
          {retry && !gone ? (
            <button
              type="button"
              className="focus-ring rounded-sm font-azeret text-2xs font-semibold text-ink underline"
              onClick={retry}
            >
              Try again
            </button>
          ) : null}
          {topic ? (
            <Link
              to="/help"
              search={{ topic, reference }}
              className="focus-ring rounded-sm font-azeret text-2xs font-semibold text-ink underline"
            >
              Help with this error
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
