import { cn, Skeleton } from "@crowhr/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import * as React from "react";
import { meQuery } from "../auth/session.ts";
import { ApiError, apiGet, apiPost } from "../lib/api.ts";
import { shellExtensions } from "../shell/extensions.ts";

interface Persona {
  membershipId: string;
  displayName: string;
  email: string;
  roles: string[];
  /** Demo companies: the server's label for the sample company's featured people. */
  persona?: { key: string; label: string; blurb: string; order: number };
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", hr_admin: "HR admin", payroll_admin: "Payroll admin" };

/** After a demo Singpass login the visitor picks one of these (persona keys from the demo build). */
export const DEMO_SINGPASS_PERSONAS = ["hr", "employee"] as const;

/**
 * One click signs in as a fictional person, with no password:
 * - the browser demo (auth spec "Demo-mode sign-in"): its seeded accounts;
 * - a demo company (`demoCompany`): that company's people, in the browser or, with
 *   `nativeRequestId`, for the Crow HR app's sign-in (the server answers with the app redirect).
 * The server answers these routes with 404 anywhere else, so this cannot be used on a real
 * organisation even if rendered. `only` limits the list to those persona keys (after a demo
 * Singpass login: HR admin or Employee).
 */
export function DemoPersonaPicker({
  only,
  demoCompany,
  title = "Pick someone to be",
  intro = "One click signs you in as a fictional Kopi Kaki employee. Each sees what their role allows.",
}: {
  only?: readonly string[];
  demoCompany?: { orgSlug: string; nativeRequestId?: string };
  title?: string;
  intro?: string;
} = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const org = demoCompany?.orgSlug;
  const q = useQuery({
    queryKey: ["demo-personas", org ?? null],
    queryFn: () =>
      apiGet<{ items: Persona[] }>(`/api/v1/auth/demo/personas${org ? `?org=${encodeURIComponent(org)}` : ""}`),
  });
  const described: Record<string, { key?: string; label: string; blurb: string; order: number }> = org
    ? Object.fromEntries((q.data?.items ?? []).flatMap((p) => (p.persona ? [[p.email, p.persona]] : [])))
    : (shellExtensions.demoPersonas ?? {});
  const all = q.data?.items ?? [];
  const featured = all
    .filter((p) => described[p.email] && (!only || only.includes(described[p.email]?.key ?? "")))
    .sort((a, b) => (described[a.email]?.order ?? 0) - (described[b.email]?.order ?? 0));
  const others = only ? [] : all.filter((p) => !described[p.email]);

  const signIn = async (p: Persona) => {
    setBusy(p.membershipId);
    setError(null);
    try {
      const result = await apiPost<{ redirectTo?: string } | undefined>("/api/v1/auth/demo/sign-in", {
        membershipId: p.membershipId,
        ...(org ? { org } : {}),
        ...(demoCompany?.nativeRequestId ? { native: demoCompany.nativeRequestId } : {}),
      });
      if (result?.redirectTo) {
        // The Crow HR app's sign-in: hand the one-time code back to the app.
        window.location.assign(result.redirectTo);
        return;
      }
      qc.clear();
      await qc.fetchQuery(meQuery);
      await navigate({ to: "/" });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404 && org
            ? "This demo company has ended or no longer has that person. Start a new one on the try page."
            : err.message
          : "Couldn't sign in. Reload the page and try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="demo-personas-title" className="mb-8" data-testid="demo-personas">
      <h2
        id="demo-personas-title"
        className="mb-1 font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300"
      >
        {title}
      </h2>
      <p className="mb-3 text-ui text-primary-300">{intro}</p>
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          {(only ?? ["0", "1", "2", "3", "4"]).map((k) => (
            <Skeleton key={k} className="h-14 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="text-ui text-danger-300" role="alert">
          The people didn't load. Reload the page to try again.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(featured.length || only ? featured : all).map((p) => {
            const meta = described[p.email];
            return (
              <li key={p.membershipId}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void signIn(p)}
                  data-testid={`persona-${meta?.label.toLowerCase().replace(/\s+/g, "-") ?? p.membershipId}`}
                  className={cn(
                    "focus-ring group flex w-full items-center gap-3 rounded-md border border-border bg-surface-50 px-3 py-2.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-100/60 disabled:opacity-60",
                    busy === p.membershipId && "border-ink bg-kuning-50",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-azeret text-2xs font-semibold uppercase tracking-wider">
                        {meta?.label ??
                          (p.roles.length ? p.roles.map((r) => ROLE_LABEL[r] ?? r).join(" + ") : "Employee")}
                      </span>
                      <span className="text-ui font-medium">{p.displayName}</span>
                    </span>
                    {meta ? <span className="block text-2xs text-primary-300">{meta.blurb}</span> : null}
                  </span>
                  <ArrowRight
                    className="size-4 shrink-0 text-primary-200 transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {featured.length && others.length ? (
        <details className="mt-3">
          <summary className="focus-ring cursor-pointer rounded-sm text-2xs font-medium text-primary-300 hover:text-ink">
            More team members ({others.length})
          </summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {others.map((p) => (
              <li key={p.membershipId}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void signIn(p)}
                  className="focus-ring rounded-md border border-border px-2.5 py-1.5 text-ui hover:border-ink/40"
                >
                  {p.displayName}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {error ? (
        <p className="mt-2 text-ui text-danger-300" role="alert">
          {error}
        </p>
      ) : null}
      {shellExtensions.demoSignInNote && !only && !org ? (
        <p className="mt-3 text-2xs text-primary-300">{shellExtensions.demoSignInNote}</p>
      ) : null}
    </section>
  );
}
