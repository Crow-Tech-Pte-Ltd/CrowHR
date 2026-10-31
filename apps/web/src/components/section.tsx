import { Card } from "@crowhr/ui";
import type * as React from "react";

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
          <h2
            id={id ? `${id}-title` : undefined}
            className="font-azeret text-xs font-semibold uppercase tracking-wider"
          >
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
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 p-4 text-ui text-danger-300 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        {error instanceof Error ? error.message : "This didn't load."} Try again; if it keeps failing, tell your
        administrator.
      </span>
      {retry ? (
        <button
          type="button"
          className="focus-ring self-start rounded-sm font-azeret text-2xs font-semibold text-ink underline"
          onClick={retry}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
