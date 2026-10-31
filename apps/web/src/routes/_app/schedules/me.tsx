import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  FormField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  StatusPill,
  Textarea,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, CalendarClock, UserRound } from "lucide-react";
import * as React from "react";
import { useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { apiPost } from "../../../lib/api.ts";
import {
  addDays,
  COLOUR_BAR,
  hm,
  type MyShift,
  mondayOf,
  myScheduleQuery,
  rosterByIdQuery,
  SWAP_STATUS,
  type Swap,
  schedKeys,
  shortDay,
  todaySg,
  weekLabel,
} from "../../../schedules/api.ts";

export const Route = createFileRoute("/_app/schedules/me")({
  validateSearch: (s: Record<string, unknown>): { week?: string } =>
    typeof s.week === "string" && /^\d{4}-\d\d-\d\d$/.test(s.week) ? { week: s.week } : {},
  component: MySchedulePage,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : "That didn't work. Try again.");

function MySchedulePage() {
  const me = useMe();
  const today = todaySg();
  const from = today;
  const to = addDays(today, 13);
  const q = useQuery({ ...myScheduleQuery(from, to), enabled: !!me.employeeId });
  const [offer, setOffer] = React.useState<MyShift | null>(null);
  if (!me.employeeId) {
    return (
      <>
        <PageHeader title="My schedule" />
        <EmptyState
          icon={<UserRound />}
          title="Your sign-in isn't linked to an employee record"
          description="There's no schedule to show. Ask HR to link your sign-in to your employee record."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="My schedule"
        description="Your published shifts for the next 14 days. Offer a shift to a colleague or pick up an open one."
        actions={
          <Button asChild variant="secondary" size="sm" className="hidden sm:inline-flex">
            <Link to="/schedules">
              <CalendarClock aria-hidden /> Outlet roster
            </Link>
          </Button>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Offers swaps={q.data.swaps.filter((s) => s.direction === "incoming" && s.status === "pending_peer")} />
            <Days data={q.data} from={from} to={to} today={today} onOffer={setOffer} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <OpenShifts shifts={q.data.openShifts} />
            <Requests swaps={q.data.swaps.filter((s) => s.direction === "outgoing")} />
          </div>
        </div>
      )}
      {offer ? <OfferSheet shift={offer} onClose={() => setOffer(null)} /> : null}
    </>
  );
}

function ShiftLine({ s }: { s: MyShift }) {
  if (s.kind === "rest")
    return (
      <span className="font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-200">Rest day</span>
    );
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn("h-8 w-[3px] shrink-0 rounded-full", COLOUR_BAR[s.colour])} />
      <span className="min-w-0">
        <span className="num block text-sm font-semibold">
          {s.start}–{s.end}
          {s.templateCode ? <span className="ml-2 text-2xs font-normal text-primary-300">{s.templateCode}</span> : null}
        </span>
        <span className="block text-2xs text-primary-300">
          {s.scopeLabel} · <span className="num">{hm(s.paidMinutes)}</span> paid
          {s.breakMinutes ? (
            <>
              {" "}
              · <span className="num">{s.breakMinutes}</span> min break
            </>
          ) : null}
        </span>
        {s.note ? <span className="block text-2xs text-primary-300">“{s.note}”</span> : null}
      </span>
    </span>
  );
}

function Days({
  data,
  from,
  to,
  today,
  onOffer,
}: {
  data: { shifts: MyShift[]; weeks: { weekStart: string; published: boolean }[] };
  from: string;
  to: string;
  today: string;
  onOffer: (s: MyShift) => void;
}) {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const weeks = [...new Set(dates.map(mondayOf))];
  const published = new Map(data.weeks.map((w) => [w.weekStart, w.published]));
  const thisWeek = mondayOf(today);
  return (
    <Card aria-labelledby="days-title">
      <CardHeader>
        <CardTitle id="days-title">Next 14 days</CardTitle>
      </CardHeader>
      <div className="border-t border-border" data-testid="my-days">
        {weeks.map((w) => {
          const days = dates.filter((d) => mondayOf(d) === w);
          if (!published.get(w)) {
            return (
              <p
                key={w}
                className="border-b border-border px-4 py-3 text-ui text-primary-300 last:border-b-0"
                data-testid="unpublished-week"
              >
                {w === thisWeek
                  ? "This week's schedule hasn't been published yet."
                  : w === addDays(thisWeek, 7)
                    ? "Next week's schedule hasn't been published yet."
                    : `The schedule for ${weekLabel(w)} hasn't been published yet.`}
              </p>
            );
          }
          return (
            <ul key={w} className="divide-y divide-border border-b border-border last:border-b-0">
              {days.map((d) => {
                const mine = data.shifts.filter((s) => s.date === d);
                return (
                  <li
                    key={d}
                    data-testid={`day-${d}`}
                    className={cn("flex items-start gap-3 px-4 py-2.5", d === today && "bg-kuning-50/60")}
                  >
                    <span className="w-16 shrink-0 pt-0.5">
                      <span className="block font-azeret text-2xs font-semibold uppercase">
                        {shortDay(d).slice(0, 3)}
                      </span>
                      <span className="num block text-2xs text-primary-300">{shortDay(d).slice(4)}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      {mine.length ? (
                        mine.map((s) => (
                          <span key={s.id} className="flex items-center justify-between gap-2">
                            <ShiftLine s={s} />
                            {s.kind === "shift" && d >= today ? (
                              s.pendingSwap ? (
                                <StatusPill tone="warning">Swap asked</StatusPill>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onOffer(s)}
                                  aria-label={`Swap or give away ${shortDay(d)}`}
                                >
                                  <ArrowLeftRight aria-hidden /> Swap
                                </Button>
                              )
                            ) : null}
                          </span>
                        ))
                      ) : (
                        <span className="pt-0.5 text-ui text-primary-200">Off</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        })}
      </div>
    </Card>
  );
}

function useSwapAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "accept" | "decline" | "cancel" }) =>
      apiPost<Swap>(`/api/v1/scheduling/swaps/${v.id}/${v.action}`),
    onSuccess: (s, v) => {
      toast.success(
        v.action === "accept"
          ? "Accepted. Your manager will approve it."
          : v.action === "decline"
            ? "Declined"
            : "Request cancelled",
      );
      void qc.invalidateQueries({ queryKey: schedKeys.all });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      return s;
    },
    onError: (err) => toast.error(errorText(err)),
  });
}

function Offers({ swaps }: { swaps: Swap[] }) {
  const act = useSwapAction();
  if (!swaps.length) return null;
  return (
    <Card aria-labelledby="offers-title" className="border-ink/30">
      <CardHeader>
        <CardTitle id="offers-title">Waiting for your answer</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-border border-t border-border" data-testid="swap-offers">
        {swaps.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-ui">
              {s.kind === "swap" ? (
                <>
                  <span className="font-medium">{s.requester.name}</span> asks to swap their{" "}
                  <span className="num">
                    {shortDay(s.shift.date)} {s.shift.time}
                  </span>{" "}
                  for your{" "}
                  <span className="num">
                    {shortDay(s.peerShift?.date ?? "")} {s.peerShift?.time}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium">{s.requester.name}</span> offers you their shift on{" "}
                  <span className="num">
                    {shortDay(s.shift.date)} {s.shift.time}
                  </span>
                </>
              )}
              {s.note ? <span className="block text-2xs text-primary-300">“{s.note}”</span> : null}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => act.mutate({ id: s.id, action: "decline" })}
                disabled={act.isPending}
              >
                Decline
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => act.mutate({ id: s.id, action: "accept" })}
                disabled={act.isPending}
              >
                Accept
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OpenShifts({ shifts }: { shifts: MyShift[] }) {
  const qc = useQueryClient();
  const ask = useMutation({
    mutationFn: (id: string) => apiPost<Swap>("/api/v1/scheduling/swaps", { kind: "pickup", shiftId: id }),
    onSuccess: () => {
      toast.success("Asked. Your manager will approve it.");
      void qc.invalidateQueries({ queryKey: schedKeys.all });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Card aria-labelledby="open-title">
      <CardHeader>
        <CardTitle id="open-title">Open shifts</CardTitle>
      </CardHeader>
      {shifts.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {shifts.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block font-azeret text-2xs font-semibold uppercase">{shortDay(s.date)}</span>
                <ShiftLine s={s} />
              </span>
              <Button size="sm" variant="secondary" onClick={() => ask.mutate(s.id)} disabled={ask.isPending}>
                Pick up
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border px-4 py-3 text-ui text-primary-300">No open shifts in the next 14 days.</p>
      )}
    </Card>
  );
}

function Requests({ swaps }: { swaps: Swap[] }) {
  const act = useSwapAction();
  return (
    <Card aria-labelledby="requests-title">
      <CardHeader>
        <CardTitle id="requests-title">My swap requests</CardTitle>
      </CardHeader>
      {swaps.length ? (
        <ul className="divide-y divide-border border-t border-border" data-testid="my-swaps">
          {swaps.slice(0, 10).map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 text-ui">
                <span className="block">
                  {s.kind === "pickup" ? "Pick up" : s.kind === "swap" ? "Swap" : "Give away"}{" "}
                  <span className="num">{shortDay(s.shift.date)}</span>
                  {s.peer ? <> with {s.peer.name}</> : null}
                </span>
                <span className="block pt-1">
                  <StatusPill tone={SWAP_STATUS[s.status].tone}>{SWAP_STATUS[s.status].label}</StatusPill>
                </span>
                {s.reason && s.status !== "approved" ? (
                  <span className="block text-2xs text-primary-300">{s.reason}</span>
                ) : null}
              </span>
              {s.status === "pending_peer" || s.status === "pending_approval" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act.mutate({ id: s.id, action: "cancel" })}
                  disabled={act.isPending}
                >
                  Cancel
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border px-4 py-3 text-ui text-primary-300">You haven't asked for any swaps.</p>
      )}
    </Card>
  );
}

function OfferSheet({ shift, onClose }: { shift: MyShift; onClose: () => void }) {
  const me = useMe();
  const roster = useQuery(rosterByIdQuery(shift.rosterId));
  const qc = useQueryClient();
  const [kind, setKind] = React.useState<"giveaway" | "swap">("swap");
  const [peer, setPeer] = React.useState<string>("");
  const [peerShift, setPeerShift] = React.useState<string>("");
  const [note, setNote] = React.useState("");
  const today = todaySg();
  const colleagues = (roster.data?.employees ?? []).filter((e) => e.id !== me.employeeId);
  const theirShifts = (roster.data?.shifts ?? []).filter(
    (s) => s.employeeId === peer && s.kind === "shift" && s.date >= today && !s.pendingSwap,
  );
  const send = useMutation({
    mutationFn: () =>
      apiPost<Swap>("/api/v1/scheduling/swaps", {
        kind,
        shiftId: shift.id,
        peerEmployeeId: peer,
        peerShiftId: kind === "swap" ? peerShift : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Sent. Your colleague accepts first, then your manager approves.");
      void qc.invalidateQueries({ queryKey: schedKeys.all });
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto p-5" data-testid="offer-sheet">
        <SheetTitle>
          {shortDay(shift.date)},{" "}
          <span className="num">
            {shift.start}–{shift.end}
          </span>
        </SheetTitle>
        <SheetDescription>
          Your colleague accepts first, then your manager approves. Nothing changes until then.
        </SheetDescription>
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as "swap" | "giveaway")}
            aria-label="Type of request"
          >
            <span className="flex items-center gap-2 text-ui">
              <RadioGroupItem id="offer-swap" value="swap" />
              <label htmlFor="offer-swap">Swap for one of their shifts</label>
            </span>
            <span className="flex items-center gap-2 text-ui">
              <RadioGroupItem id="offer-giveaway" value="giveaway" />
              <label htmlFor="offer-giveaway">Give it away</label>
            </span>
          </RadioGroup>
          <FormField label="Colleague" required>
            <Select
              value={peer}
              onValueChange={(v) => {
                setPeer(v);
                setPeerShift("");
              }}
            >
              <SelectTrigger aria-label="Colleague">
                <SelectValue placeholder={roster.isPending ? "Loading…" : "Choose a colleague"} />
              </SelectTrigger>
              <SelectContent>
                {colleagues.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {kind === "swap" && peer ? (
            <FormField label="Their shift you'd take" required>
              {theirShifts.length ? (
                <Select value={peerShift} onValueChange={setPeerShift}>
                  <SelectTrigger aria-label="Their shift">
                    <SelectValue placeholder="Choose a shift" />
                  </SelectTrigger>
                  <SelectContent>
                    {theirShifts.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {shortDay(s.date)} {s.start}–{s.end}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-ui text-primary-300">
                  They have no upcoming shifts on this roster. Give the shift away instead.
                </p>
              )}
            </FormField>
          ) : null}
          <FormField label="Note" hint="Optional. Up to 200 characters.">
            <Textarea rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!peer || (kind === "swap" && !peerShift) || send.isPending}
            >
              {send.isPending ? "Sending…" : "Send request"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
