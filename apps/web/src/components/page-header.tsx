import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type * as React from "react";

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  leading,
  trailing,
}: {
  title: React.ReactNode;
  /** Shown before the title, outside the heading (an avatar). */
  leading?: React.ReactNode;
  /** Shown after the title, outside the heading (status pills), so the page title stays just the name. */
  trailing?: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 font-azeret text-2xs text-primary-200">
              {crumbs.map((c) => (
                <li key={c.label} className="flex items-center gap-1">
                  {c.to ? (
                    <Link to={c.to} className="focus-ring rounded-sm hover:text-ink hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                  <ChevronRight className="size-3" aria-hidden />
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {leading || trailing ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {leading}
            <h1 className="text-xl font-semibold leading-7 sm:text-[22px]">{title}</h1>
            {trailing}
          </div>
        ) : (
          <h1 className="text-xl font-semibold leading-7 sm:text-[22px]">{title}</h1>
        )}
        {description ? <p className="max-w-2xl text-ui leading-5 text-primary-300">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
