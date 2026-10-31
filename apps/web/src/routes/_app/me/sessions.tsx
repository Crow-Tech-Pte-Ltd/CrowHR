import {
  Badge,
  Button,
  EmptyState,
  ProviderButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Laptop, Link2, Smartphone } from "lucide-react";
import { relativeTime } from "../../../auth/format.ts";
import { useReauth } from "../../../auth/reauth.tsx";
import { useMe } from "../../../auth/session.ts";
import type { SessionItem, SignInMethods } from "../../../auth/types.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote, Section } from "../../../components/section.tsx";
import { ApiError, apiDelete, apiGet, apiPost } from "../../../lib/api.ts";
import { MfaCard } from "../../../me/mfa-card.tsx";
import { PasswordCard } from "../../../me/password-card.tsx";

export const Route = createFileRoute("/_app/me/sessions")({
  validateSearch: (s: Record<string, unknown>): { enrol?: string; link?: string; reason?: string } => ({
    ...(typeof s.enrol === "string" ? { enrol: s.enrol } : {}),
    ...(typeof s.link === "string" ? { link: s.link } : {}),
    ...(typeof s.reason === "string" ? { reason: s.reason } : {}),
  }),
  component: MySecurity,
});

function MySecurity() {
  const me = useMe();
  const search = Route.useSearch();
  return (
    <>
      <PageHeader
        kicker="Me"
        title="Sign-in and devices"
        description="How you sign in, two-step verification, and where you're signed in."
      />
      <Section id="mfa" title="Two-step verification">
        <MfaCard autoStart={search.enrol === "1"} />
      </Section>
      {me.mfa.blocked ? null : (
        <>
          <Section
            id="sessions"
            title="Sessions and devices"
            description="Browsers and phones signed in to your account. Sign out any you don't recognise."
          >
            <SessionsTable />
          </Section>
          <Section
            id="identities"
            title="Linked sign-in methods"
            description="Single sign-on accounts that can sign you in."
          >
            <Identities linkResult={search.link} />
          </Section>
          <Section id="password" title="Password">
            <PasswordCard />
          </Section>
        </>
      )}
    </>
  );
}

function SessionsTable() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me", "sessions"],
    queryFn: () => apiGet<{ items: SessionItem[] }>("/api/v1/me/sessions"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/me/sessions/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success("Signed out that session.");
      void qc.invalidateQueries({ queryKey: ["me", "sessions"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't sign it out."),
  });
  const others = useMutation({
    mutationFn: () => apiPost<{ revoked: number }>("/api/v1/me/sessions/revoke-others"),
    onSuccess: (r) => {
      toast.success(
        r.revoked
          ? `Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}.`
          : "No other sessions were signed in.",
      );
      void qc.invalidateQueries({ queryKey: ["me", "sessions"] });
    },
  });
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true" aria-label="Loading sessions">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  if (q.isError) return <ErrorNote error={q.error} retry={() => void q.refetch()} />;
  const items = q.data.items;
  return (
    <>
      <Table data-testid="sessions-table">
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead className="hidden sm:table-cell">IP address</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  {s.kind === "mobile" ? (
                    <Smartphone className="size-4" aria-hidden />
                  ) : (
                    <Laptop className="size-4" aria-hidden />
                  )}
                  <span>{s.device}</span>
                  {s.kind === "mobile" ? <Badge variant="muted">Mobile app</Badge> : null}
                  {s.current ? <Badge variant="brand">This device</Badge> : null}
                </span>
              </TableCell>
              <TableCell className="num hidden sm:table-cell">{s.ip ?? "—"}</TableCell>
              <TableCell className="num">{relativeTime(s.lastActiveAt)}</TableCell>
              <TableCell>
                {s.current ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutate(s.id)}
                    disabled={revoke.isPending}
                    aria-label={`Sign out ${s.device}`}
                  >
                    Sign out
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {items.length > 1 ? (
        <div className="border-t border-border p-3">
          <Button size="sm" variant="secondary" onClick={() => others.mutate()} disabled={others.isPending}>
            Sign out everywhere else
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Identities({ linkResult }: { linkResult?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const withReauth = useReauth();
  const ids = useQuery({
    queryKey: ["me", "identities"],
    queryFn: () =>
      apiGet<{
        items: { id: string; providerName: string; kind: string; linkedAt: string; lastUsedAt: string | null }[];
      }>("/api/v1/me/identities"),
  });
  const methods = useQuery({
    queryKey: ["auth-methods", me.organisation.slug],
    queryFn: () => apiGet<SignInMethods>(`/api/v1/auth/methods?org=${encodeURIComponent(me.organisation.slug ?? "")}`),
    enabled: !!me.organisation.slug,
  });
  const unlink = async (id: string) => {
    try {
      await withReauth(() => apiDelete(`/api/v1/me/identities/${id}`));
      toast.success("Unlinked.");
      void qc.invalidateQueries({ queryKey: ["me", "identities"] });
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "reauth_required"))
        toast.error(err instanceof Error ? err.message : "Couldn't unlink.");
    }
  };
  if (ids.isPending)
    return (
      <div className="p-4">
        <Skeleton className="h-8 w-full" />
      </div>
    );
  if (ids.isError) return <ErrorNote error={ids.error} retry={() => void ids.refetch()} />;
  const linkedKinds = new Set(ids.data.items.map((i) => i.kind));
  const linkable = (methods.data?.providers ?? []).filter((p) => !linkedKinds.has(p.kind));
  return (
    <div className="flex flex-col gap-3 p-4">
      {linkResult === "ok" ? <p className="text-ui text-success-400">Linked. You can now sign in with it.</p> : null}
      {linkResult === "failed" ? (
        <p className="text-ui text-danger-300">
          Linking failed. That account may already be linked to someone else; try again or ask an owner.
        </p>
      ) : null}
      {ids.data.items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={<Link2 />}
          title="No single sign-on linked"
          description="You sign in with your email and password."
        />
      ) : (
        <ul className="divide-y divide-border">
          {ids.data.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-2">
              <span>
                <span className="font-medium">{i.providerName}</span>
                <span className="ml-2 text-2xs text-primary-200">Last used {relativeTime(i.lastUsedAt)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void unlink(i.id)}>
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      {linkable.length && !me.demoMode ? (
        <div className="flex max-w-xs flex-col gap-2">
          {linkable.map((p) => (
            <ProviderButton
              key={p.id}
              provider={p.kind === "entra" ? "microsoft" : p.kind}
              oidcName={p.kind === "oidc" ? p.displayName : undefined}
              onClick={() => window.location.assign(`/api/v1/auth/oidc/${p.id}/start?purpose=link`)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
