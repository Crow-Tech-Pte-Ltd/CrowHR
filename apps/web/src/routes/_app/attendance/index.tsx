import {
  appNow,
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  formatDate,
  Skeleton,
  StatusPill,
  toast,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { CloudOff, LogIn, LogOut, MapPin, UserRound, X } from "lucide-react";
import * as React from "react";
import { FLAG_TEXT, type Punch, type PunchFlag, sgTime, statusQuery } from "../../../attendance/api.ts";
import { AttendanceNav } from "../../../attendance/attendance-nav.tsx";
import { nextKind, type QueuedPunch, QueueFullError } from "../../../attendance/punch-queue.ts";
import { usePunchQueue } from "../../../attendance/use-punch-queue.ts";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { todaySg, weekdayOf } from "../../../leave/format.ts";

export const Route = createFileRoute("/_app/attendance/")({
  component: ClockPage,
});

const PDPA_ACK = "crowhr.pdpaAck.v1";

function useNow() {
  const [now, setNow] = React.useState(() => appNow());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(appNow()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useOnline() {
  const [online, setOnline] = React.useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  React.useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function getLocation(): Promise<QueuedPunch["location"]> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracyMetres: Math.round(p.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
    );
  });
}

const ackKey = (orgId: string) => `${PDPA_ACK}:${orgId}`;
function acked(orgId: string): boolean {
  try {
    return localStorage.getItem(ackKey(orgId)) === "1";
  } catch {
    return false;
  }
}

function ClockPage() {
  const me = useMe();
  const status = useQuery({ ...statusQuery, enabled: !!me.employeeId });
  const { state, tap, dismiss } = usePunchQueue();
  const now = useNow();
  const online = useOnline();
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(false);
  if (!me.employeeId || !can(me, "attendance:create")) {
    const scopes = me.permissions["attendance:read"] ?? [];
    if (scopes.includes("all") || scopes.includes("team")) return <Navigate to="/attendance/team" replace />;
    return (
      <>
        <PageHeader title="Attendance" />
        <AttendanceNav current="clock" />
        <EmptyState
          icon={<UserRound />}
          title="Your sign-in isn't linked to an employee record"
          description="There's nothing to clock in to. Ask HR to link your sign-in to your employee record."
        />
      </>
    );
  }
  const s = status.data;
  const kind = nextKind(state, s?.clockedIn ?? false);
  const locationMode = s?.location.mode ?? "off";
  const go = async () => {
    setBusy(true);
    try {
      const location = locationMode === "off" ? null : await getLocation();
      await tap(kind, location);
    } catch (err) {
      toast.error(err instanceof QueueFullError ? err.message : "That punch couldn't be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const onTap = () => {
    if (locationMode !== "off" && !acked(me.organisation.id)) setNotice(true);
    else void go();
  };
  const lastQueued = state.pending.at(-1);
  const sinceIso = lastQueued?.kind === "in" ? lastQueued.deviceTime : s?.clockedIn ? s.lastPunch?.recordedAt : null;
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Clock in and out. It works offline: punches wait on this device and send themselves."
      />
      <AttendanceNav current="clock" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col items-center gap-5 px-5 py-8 text-center" data-testid="clock-card">
          <div>
            <p className="font-azeret text-2xs uppercase tracking-wider text-primary-200">
              Singapore time · {formatDate(new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10))}
            </p>
            <p className="num mt-1 text-5xl font-semibold tracking-tight" data-testid="clock-now">
              {sgTime(now.toISOString(), true)}
            </p>
          </div>
          {status.isPending ? (
            <Skeleton className="h-16 w-64" />
          ) : status.isError && !state.pending.length ? (
            <ErrorNote error={status.error} retry={() => void status.refetch()} />
          ) : (
            <>
              <p className="text-ui text-primary-300" data-testid="clock-state">
                {kind === "out" && sinceIso ? (
                  <>
                    Clocked in since <span className="num font-semibold text-ink">{sgTime(sinceIso)}</span>
                  </>
                ) : (
                  "You're not clocked in."
                )}
              </p>
              <Button
                variant="primary"
                className="h-20 w-full max-w-xs text-lg [&_svg]:size-6"
                disabled={busy}
                onClick={onTap}
                data-testid="clock-button"
              >
                {kind === "in" ? <LogIn /> : <LogOut />}
                {busy
                  ? locationMode === "off"
                    ? "Saving…"
                    : "Getting location…"
                  : kind === "in"
                    ? "Clock in"
                    : "Clock out"}
              </Button>
              {locationMode !== "off" ? (
                <p className="flex items-center gap-1.5 text-2xs text-primary-300">
                  <MapPin className="size-3.5" aria-hidden />
                  Your location is recorded with each punch.{" "}
                  <button
                    type="button"
                    className="focus-ring rounded-sm text-biru-400 hover:underline"
                    onClick={() => setNotice(true)}
                  >
                    Why?
                  </button>
                </p>
              ) : null}
            </>
          )}
          {!online || state.pending.length ? (
            <div
              role="status"
              data-testid="punch-queue"
              className="flex w-full max-w-sm items-start gap-2 rounded-md border border-warning-300/50 bg-warning-50 px-3 py-2 text-left text-ui text-warning-400"
            >
              <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {state.pending.length ? (
                  <>
                    <span className="font-semibold">
                      {state.pending.length} {state.pending.length === 1 ? "punch" : "punches"} waiting to send.
                    </span>{" "}
                    {online
                      ? (state.pending[0]?.lastError ?? "Sending…")
                      : "Queued — will send when you're back online."}
                    <span className="mt-1 block text-2xs">
                      {state.pending
                        .map((p) => `${p.kind === "in" ? "In" : "Out"} ${sgTime(p.deviceTime)}`)
                        .join(" · ")}
                    </span>
                  </>
                ) : (
                  "You're offline. You can still clock in; it will send when you're back online."
                )}
              </span>
            </div>
          ) : null}
        </Card>
        <div className="flex flex-col gap-6">
          {state.history.some((h) => h.outcome === "rejected") ? (
            <Card aria-labelledby="refused-title" className="border-danger-200/50">
              <CardHeader>
                <CardTitle id="refused-title">Not recorded</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-border border-t border-border" data-testid="punch-rejections">
                {state.history
                  .filter((h) => h.outcome === "rejected")
                  .map((h) => (
                    <li key={h.idempotencyKey} className="flex items-start justify-between gap-3 px-4 py-2.5 text-ui">
                      <span>
                        <span className="num font-semibold">
                          {h.kind === "in" ? "In" : "Out"} {sgTime(h.deviceTime)}
                        </span>{" "}
                        <span className="text-danger-300">{h.message}</span>
                        <span className="block text-2xs text-primary-200">
                          Ask your manager to add it if it was right.
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label="Dismiss"
                        className="focus-ring rounded-sm p-0.5 text-primary-200 hover:text-ink"
                        onClick={() => dismiss(h.idempotencyKey)}
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
          <Card aria-labelledby="today-title">
            <CardHeader>
              <CardTitle id="today-title">Today’s punches</CardTitle>
            </CardHeader>
            {status.isPending ? (
              <div className="border-t border-border p-4">
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (s?.today.length ?? 0) === 0 ? (
              <p className="border-t border-border px-4 py-3 text-ui text-primary-300">No punches yet today.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border" data-testid="today-punches">
                {s?.today.map((p) => (
                  <PunchRow key={p.id} p={p} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Dialog open={notice} onOpenChange={setNotice}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your location and clocking in</DialogTitle>
            <DialogDescription>Personal Data Protection Act notice from {me.organisation.name}.</DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-line text-ui" data-testid="pdpa-notice">
            {s?.location.pdpaNotice}
          </p>
          {s?.location.offices.length ? (
            <p className="text-2xs text-primary-300">
              Checked against: {s.location.offices.map((o) => `${o.name} (${o.radiusMetres} m)`).join(", ")}.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotice(false)}>
              Not now
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                try {
                  localStorage.setItem(ackKey(me.organisation.id), "1");
                } catch {
                  // Shown again next time; harmless.
                }
                setNotice(false);
                void go();
              }}
            >
              I understand, clock {kind}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PunchRow({ p }: { p: Punch }) {
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 px-4 py-2.5 text-ui",
        p.voided && "text-primary-200 line-through",
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>
          {p.workDate !== todaySg() ? <span className="text-primary-300">{weekdayOf(p.workDate)} </span> : null}
          <span className="num font-semibold">{sgTime(p.recordedAt)}</span>{" "}
          {p.kind === "in" ? "Clocked in" : "Clocked out"}
          {p.source === "correction" ? <span className="text-primary-300"> · added by your manager</span> : null}
        </span>
        {p.flags.length ? (
          <span className="text-2xs text-warning-400">{p.flags.map((f) => FLAG_TEXT[f as PunchFlag]).join(" · ")}</span>
        ) : null}
        {p.queued ? (
          <span className="num text-2xs text-primary-200">
            Tapped {sgTime(p.deviceTime)} on the device, received {sgTime(p.serverTime)}
          </span>
        ) : null}
      </span>
      <StatusPill tone={p.status === "flagged" ? "warning" : "success"}>
        {p.status === "flagged" ? "Check" : "OK"}
      </StatusPill>
    </li>
  );
}
