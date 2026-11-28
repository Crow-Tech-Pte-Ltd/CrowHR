import type { SystemStatus } from "@crowhr/core";
import { Alert, AlertDescription, AlertTitle, Button, Skeleton, StatusPill, textStyle } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleAlert, Lock, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { systemStatusQuery } from "../../../help/system-status.ts";
import { useT } from "../../../i18n/index.ts";
import { ApiError } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/settings/system")({
  component: SystemPage,
});

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
  const t = useT("settings-account");
  const q = useQuery(systemStatusQuery);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("Settings"), to: "/settings" }]}
        title={t("System")}
        description={t("Version, database, backups, disk space and how requests reach this server.")}
        actions={
          <Button asChild size="sm">
            <Link to="/help" search={{ topic: "service" }}>
              {t("Troubleshoot this server")}
            </Link>
          </Button>
        }
      />
      {q.isPending ? (
        <div
          className="grid gap-4 md:grid-cols-2"
          role="status"
          aria-busy="true"
          aria-label={t("Loading system status")}
        >
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
        <h2 className={textStyle.section}>{title}</h2>
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
  const t = useT("settings-account");
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
              {ok ? t("The last successful backup is more than 48 hours old") : t("No successful backup yet")}
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
            <AlertTitle>{t("Scheduled backups require encryption")}</AlertTitle>
            <AlertDescription>
              Scheduled backups are disabled until encryption is configured. Backups include the master key needed to
              restore NRIC, bank and SSO data. Set <code className="num">BACKUP_PASSPHRASE</code> in .env, keep the
              passphrase outside this server and restart Crow HR.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t("Server")}>
          <Row label={t("Version")}>
            <span className={mono}>{s.version}</span>
          </Row>
          <Row label={t("Address")}>
            <span className={mono}>{s.publicUrl ?? t("Not reported")}</span>
          </Row>
          <Row label={t("HTTPS cookies")}>
            {s.secureCookies === null ? (
              t("Not reported")
            ) : s.secureCookies ? (
              <StatusPill tone="success">{t("Secure")}</StatusPill>
            ) : (
              <StatusPill tone="warning">{t("Plain http")}</StatusPill>
            )}
          </Row>
          <Row label={t("Server time")}>
            <span className="num">{formatSgDateTime(s.time)}</span>
          </Row>
        </Section>

        <Section
          title={t("Database")}
          aside={
            <StatusPill tone={s.database.status === "ok" ? "success" : "danger"}>
              {s.database.status === "ok" ? t("Connected") : t("Unreachable")}
            </StatusPill>
          }
        >
          <Row label={t("Engine")}>
            <span className="num">
              {s.database.driver === "pglite" ? t("PGlite (development)") : "PostgreSQL"}{" "}
              {s.database.serverVersion ?? ""}
            </span>
          </Row>
          <Row label={t("Schema")}>
            <span className={mono}>{s.schema.tag ?? "—"}</span>
          </Row>
          <Row label={t("Migrations")}>
            <span className="num">
              {s.schema.appliedMigrations ?? "—"} applied
              {pending ? `, ${pending} pending` : ""}
            </span>
          </Row>
          <Row label={t("Last migrated")}>
            <span className="num">
              {s.schema.migratedAt ? formatSgDateTime(s.schema.migratedAt) : "—"}
              {s.schema.migratedByVersion ? ` by ${s.schema.migratedByVersion}` : ""}
            </span>
          </Row>
        </Section>

        <Section
          title={t("Backups")}
          aside={
            last ? (
              <StatusPill
                tone={last.status === "succeeded" ? "success" : last.status === "failed" ? "danger" : "info"}
                data-testid="last-backup-status"
              >
                {last.status === "succeeded" ? t("OK") : last.status === "failed" ? t("Failed") : t("Running")}
              </StatusPill>
            ) : null
          }
        >
          <Row label={t("Last backup")}>
            {last ? (
              <span className="num" data-testid="last-backup">
                {formatSgDateTime(last.startedAt)} ({ago(last.startedAt, s.time)})
              </span>
            ) : (
              t("None yet")
            )}
          </Row>
          {last?.status === "failed" ? (
            <Row label={t("Error")}>
              <span className="text-danger-300">{last.error}</span>
            </Row>
          ) : null}
          <Row label={t("Last successful")}>
            {ok ? (
              <span className="num">
                {t("{value} · {value2}", { value: formatSgDateTime(ok.startedAt), value2: formatBytes(ok.sizeBytes) })}
              </span>
            ) : (
              t("None yet")
            )}
          </Row>
          <Row label={t("Schedule")}>
            {s.backups.schedule ? (
              <span className="num">
                {t("Daily")} {s.backups.schedule}
              </span>
            ) : (
              t("Off")
            )}
          </Row>
          <Row label={t("Kept")}>{s.backups.keep ? <span className="num">{s.backups.keep} newest</span> : "—"}</Row>
          <Row label={t("Stored in")}>
            <span className={mono}>{s.backups.directory ?? "—"}</span>
          </Row>
        </Section>

        <Section title={t("Disk")}>
          {s.disk.length === 0 ? (
            <Row label={t("Disk space")}>{t("Not reported")}</Row>
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
                      {t("Low")}
                    </StatusPill>
                  ) : null}
                </Row>
              );
            })
          )}
        </Section>

        <Section
          title={t("This request")}
          aside={
            <StatusPill tone={s.request.viaTrustedProxy ? "success" : "neutral"} data-testid="proxy-trust">
              {s.request.viaTrustedProxy ? t("Trusted proxy") : t("Direct")}
            </StatusPill>
          }
        >
          <Row label={t("Your IP as seen")}>
            <span className={mono} data-testid="client-ip">
              {s.request.clientIp ?? t("Unknown")}
            </span>
          </Row>
          <Row label={t("Scheme")}>
            <span className="num">{s.request.scheme}</span>
          </Row>
          <Row label={t("Connected from")}>
            <span className={mono}>{s.request.peerIp ?? t("Unknown")}</span>
          </Row>
          <Row label={t("Trusted proxies")}>
            <span className={mono}>
              {s.trustedProxies === null
                ? t("Not reported")
                : s.trustedProxies.length
                  ? s.trustedProxies.join(", ")
                  : t("None")}
            </span>
          </Row>
        </Section>
      </div>
    </div>
  );
}
