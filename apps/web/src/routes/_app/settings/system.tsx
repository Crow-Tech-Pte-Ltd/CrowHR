import type { SystemStatus } from "@crowhr/core";
import { Alert, AlertDescription, AlertTitle, Skeleton, StatusPill } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleAlert, Lock, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { ApiError, apiGet } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/settings/system")({
  component: SystemPage,
});

const statusQuery = {
  queryKey: ["system", "status"] as const,
  queryFn: () => apiGet<SystemStatus>("/api/v1/system/status"),
  refetchInterval: 60_000,
  retry: false,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `31 Oct 2026, 02:00` in Singapore time. */
export function formatSgDateTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

export function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function ago(iso: string, now: string): string {
  const h = (Date.parse(now) - Date.parse(iso)) / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Read-only: Settings → System (self-hosting spec, M3). Owners only; the API enforces it. */
function SystemPage() {
  const q = useQuery(statusQuery);
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }, { label: "System" }]}
        title="System"
        description="Version, database, backups, disk space and how requests reach this server. Read-only."
      />
      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-busy="true" aria-label="Loading system status">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : q.isError ? (
        <StatusError error={q.error} />
      ) : (
        <StatusView s={q.data} />
      )}
    </>
  );
}

function StatusError({ error }: { error: Error }) {
  const status = error instanceof ApiError ? error.status : 0;
  const title =
    status === 401 ? "Sign in as an owner" : status === 403 ? "Owners only" : "System status is not available";
  const body =
    status === 401
      ? "Sign in with an owner account to see system status."
      : status === 403
        ? "Only owners can see system status. Ask an owner if you need it."
        : `${error.message} Check that the app container is running: docker compose ps`;
  return (
    <Alert variant={status === 401 || status === 403 ? "info" : "danger"} role="alert" data-testid="system-error">
      {status === 401 || status === 403 ? <Lock aria-hidden /> : <CircleAlert aria-hidden />}
      <div>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </div>
    </Alert>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface-50" aria-label={title}>
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="font-azeret text-2xs font-semibold uppercase tracking-wider">{title}</h2>
        {aside}
      </header>
      <dl className="divide-y divide-border px-4">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-ui">
      <dt className="text-primary-300">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

const mono = "num break-all";

function StatusView({ s }: { s: SystemStatus }) {
  const last = s.backups.last;
  const ok = s.backups.lastSuccessful;
  const pending =
    s.schema.appliedMigrations !== null && s.schema.bundledMigrations !== null
      ? s.schema.bundledMigrations - s.schema.appliedMigrations
      : null;
  return (
    <div className="flex flex-col gap-4">
      {s.backups.stale ? (
        <Alert variant="warning" role="status" data-testid="backup-stale">
          <TriangleAlert aria-hidden />
          <div>
            <AlertTitle>
              {ok ? "The last successful backup is more than 48 hours old" : "No successful backup yet"}
            </AlertTitle>
            <AlertDescription>
              Run one now with <code className="num">docker compose exec app crowhr backup</code>, then check the server
              log if it fails.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      {s.backups.encrypted === false ? (
        <Alert variant="warning" role="status" data-testid="backup-unencrypted">
          <TriangleAlert aria-hidden />
          <div>
            <AlertTitle>Backups are not encrypted</AlertTitle>
            <AlertDescription>
              Each backup includes your encryption key, so anyone with a backup file can read NRIC, bank and SSO data.
              Set <code className="num">BACKUP_PASSPHRASE</code> in .env and keep the passphrase somewhere safe.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Server">
          <Row label="Version">
            <span className={mono}>{s.version}</span>
          </Row>
          <Row label="Address">
            <span className={mono}>{s.publicUrl ?? "Not reported"}</span>
          </Row>
          <Row label="HTTPS cookies">
            {s.secureCookies === null ? (
              "Not reported"
            ) : s.secureCookies ? (
              <StatusPill tone="success">Secure</StatusPill>
            ) : (
              <StatusPill tone="warning">Plain http</StatusPill>
            )}
          </Row>
          <Row label="Server time">
            <span className="num">{formatSgDateTime(s.time)}</span>
          </Row>
        </Section>

        <Section
          title="Database"
          aside={
            <StatusPill tone={s.database.status === "ok" ? "success" : "danger"}>
              {s.database.status === "ok" ? "Connected" : "Unreachable"}
            </StatusPill>
          }
        >
          <Row label="Engine">
            <span className="num">
              {s.database.driver === "pglite" ? "PGlite (development)" : "PostgreSQL"} {s.database.serverVersion ?? ""}
            </span>
          </Row>
          <Row label="Schema">
            <span className={mono}>{s.schema.tag ?? "—"}</span>
          </Row>
          <Row label="Migrations">
            <span className="num">
              {s.schema.appliedMigrations ?? "—"} applied
              {pending ? `, ${pending} pending` : ""}
            </span>
          </Row>
          <Row label="Last migrated">
            <span className="num">
              {s.schema.migratedAt ? formatSgDateTime(s.schema.migratedAt) : "—"}
              {s.schema.migratedByVersion ? ` by ${s.schema.migratedByVersion}` : ""}
            </span>
          </Row>
        </Section>

        <Section
          title="Backups"
          aside={
            last ? (
              <StatusPill
                tone={last.status === "succeeded" ? "success" : last.status === "failed" ? "danger" : "info"}
                data-testid="last-backup-status"
              >
                {last.status === "succeeded" ? "OK" : last.status === "failed" ? "Failed" : "Running"}
              </StatusPill>
            ) : null
          }
        >
          <Row label="Last backup">
            {last ? (
              <span className="num" data-testid="last-backup">
                {formatSgDateTime(last.startedAt)} ({ago(last.startedAt, s.time)})
              </span>
            ) : (
              "None yet"
            )}
          </Row>
          {last?.status === "failed" ? (
            <Row label="Error">
              <span className="text-danger-300">{last.error}</span>
            </Row>
          ) : null}
          <Row label="Last successful">
            <span className="num">
              {ok ? `${formatSgDateTime(ok.startedAt)} · ${formatBytes(ok.sizeBytes)}` : "None yet"}
            </span>
          </Row>
          <Row label="Schedule">
            <span className="num">{s.backups.schedule ? `Daily ${s.backups.schedule}` : "Off"}</span>
          </Row>
          <Row label="Kept">
            <span className="num">{s.backups.keep ?? "—"} newest</span>
          </Row>
          <Row label="Stored in">
            <span className={mono}>{s.backups.directory ?? "—"}</span>
          </Row>
        </Section>

        <Section title="Disk">
          {s.disk.length === 0 ? (
            <Row label="Disk space">Not reported</Row>
          ) : (
            s.disk.map((d) => {
              const pct = d.totalBytes ? Math.round((d.freeBytes / d.totalBytes) * 100) : 0;
              return (
                <Row key={d.path} label={d.label}>
                  <span className="num">
                    {formatBytes(d.freeBytes)} free of {formatBytes(d.totalBytes)} ({pct}%)
                  </span>
                  {pct < 10 ? (
                    <StatusPill tone="warning" className="ml-2">
                      Low
                    </StatusPill>
                  ) : null}
                </Row>
              );
            })
          )}
        </Section>

        <Section
          title="This request"
          aside={
            <StatusPill tone={s.request.viaTrustedProxy ? "success" : "neutral"} data-testid="proxy-trust">
              {s.request.viaTrustedProxy ? "Trusted proxy" : "Direct"}
            </StatusPill>
          }
        >
          <Row label="Your IP as seen">
            <span className={mono} data-testid="client-ip">
              {s.request.clientIp ?? "Unknown"}
            </span>
          </Row>
          <Row label="Scheme">
            <span className="num">{s.request.scheme}</span>
          </Row>
          <Row label="Connected from">
            <span className={mono}>{s.request.peerIp ?? "Unknown"}</span>
          </Row>
          <Row label="Trusted proxies">
            <span className={mono}>
              {s.trustedProxies === null
                ? "Not reported"
                : s.trustedProxies.length
                  ? s.trustedProxies.join(", ")
                  : "None"}
            </span>
          </Row>
        </Section>
      </div>
    </div>
  );
}
