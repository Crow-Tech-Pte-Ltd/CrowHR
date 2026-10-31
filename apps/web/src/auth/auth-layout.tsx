import type * as React from "react";
import { Wordmark } from "../components/wordmark.tsx";

/** Single-column layout for invitation, reset and organisation-chooser pages. */
export function AuthLayout({
  kicker,
  title,
  description,
  children,
}: {
  kicker?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <Wordmark />
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
        {kicker ? (
          <p className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200">{kicker}</p>
        ) : null}
        <h1 className="mb-1 text-2xl font-semibold leading-8">{title}</h1>
        {description ? <p className="mb-7 text-ui text-primary-300">{description}</p> : null}
        {children}
      </div>
    </main>
  );
}
