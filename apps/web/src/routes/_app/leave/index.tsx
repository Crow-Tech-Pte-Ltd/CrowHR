import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  RadioGroup,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Baby, CalendarPlus, CalendarX2, ChevronDown, UserRound } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import {
  type Balance,
  balancesQuery,
  type Child,
  childrenQuery,
  type LeaveRequest,
  requestsQuery,
  useLeaveInvalidate,
} from "../../../leave/api.ts";
import { ApplySheet } from "../../../leave/apply-sheet.tsx";
import { CheckRow, RadioRow } from "../../../leave/choice.tsx";
import { dateRange, fmt, qty, STATUS_LABEL, STATUS_TONE } from "../../../leave/format.ts";
import { LeaveNav } from "../../../leave/leave-nav.tsx";
import { RequestSheet } from "../../../leave/request-sheet.tsx";
import { ApiError, apiPost } from "../../../lib/api.ts";

interface LeaveSearch {
  request?: string;
  apply?: boolean;
}

export const Route = createFileRoute("/_app/leave/")({
  validateSearch: (s: Record<string, unknown>): LeaveSearch => ({
    ...(typeof s.request === "string" ? { request: s.request } : {}),
    ...(s.apply === true || s.apply === "1" || s.apply === 1 ? { apply: true } : {}),
  }),
  component: MyLeavePage,
});

function MyLeavePage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/leave/" });
  const onBehalf = (me.permissions["leave:create"] ?? []).includes("all");
  const linked = !!me.employeeId;
  const setApply = (open: boolean) =>
    void navigate({ search: (s: LeaveSearch) => ({ ...s, apply: open || undefined }), replace: true });
  return (
    <>
      <PageHeader
        title="Leave"
        description="Your balances and requests. Approved leave goes to payroll automatically."
        actions={
          can(me, "leave:create") ? (
            <Button variant="primary" onClick={() => setApply(true)} data-testid="apply-leave">
              <CalendarPlus /> Apply for leave
            </Button>
          ) : null
        }
      />
      <LeaveNav current="mine" />
      {linked ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Balances />
            <MyRequests onOpen={(id) => void navigate({ search: { request: id } })} />
          </div>
          <Children />
        </div>
      ) : (
        <EmptyState
          icon={<UserRound />}
          title="Your sign-in isn't linked to an employee record"
          description={
            onBehalf
              ? "You can still apply for leave on behalf of employees, and see everyone's leave on the calendar."
              : "Ask HR to link your sign-in to your employee record to apply for leave."
          }
        />
      )}
      <ApplySheet
        open={!!search.apply}
        onOpenChange={setApply}
        onBehalf={onBehalf}
        onApplied={(r) => void navigate({ search: { request: r.id } })}
      />
      <RequestSheet id={search.request} onClose={() => void navigate({ search: {} })} />
    </>
  );
}

const FAMILY = new Set(["maternity", "paternity", "shared_parental", "adoption"]);

function Balances() {
  const q = useQuery(balancesQuery());
  const kids = useQuery(childrenQuery());
  const [more, setMore] = React.useState(false);
  const childName = (id: string | null) => kids.data?.items.find((c) => c.id === id)?.name;
  const rows = q.data?.items ?? [];
  // Hide per-child parental rows that have no child; show "no limit" types compactly.
  const tracked = rows.filter((b) => b.tracked && !(FAMILY.has(b.statutoryCode ?? "") && !b.childId));
  const main = tracked.filter((b) => b.eligible || !FAMILY.has(b.statutoryCode ?? ""));
  const primary = main.filter((b) => b.eligible || ["annual", "sick_outpatient", "hospitalisation"].includes(b.code));
  const secondary = main.filter((b) => !primary.includes(b));
  const unlimited = rows.filter((b) => !b.tracked);
  const year = rows[0]?.year;
  return (
    <Card aria-labelledby="balances-title" data-testid="leave-balances">
      <CardHeader>
        <CardTitle id="balances-title">
          Balances{year ? <span className="num ml-2 font-normal text-primary-200">{year}</span> : null}
        </CardTitle>
      </CardHeader>
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="flex flex-col gap-2 border-t border-border p-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : (
        <>
          <BalanceTable rows={more ? [...primary, ...secondary] : primary} childName={childName} />
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-ui sm:flex-row sm:items-center sm:justify-between">
            <p className="text-primary-300">
              {unlimited.length ? `No fixed allowance: ${unlimited.map((u) => u.name).join(", ")}.` : null}
            </p>
            {secondary.length ? (
              <button
                type="button"
                className="focus-ring inline-flex shrink-0 items-center gap-1 self-start rounded-sm font-azeret text-2xs font-semibold text-biru-400 hover:underline"
                aria-expanded={more}
                onClick={() => setMore((m) => !m)}
              >
                {more ? "Fewer types" : `${secondary.length} more types`}
                <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} aria-hidden />
              </button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}

function BalanceTable({ rows, childName }: { rows: Balance[]; childName: (id: string | null) => string | undefined }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!rows.length) {
    return <p className="border-t border-border p-4 text-ui text-primary-300">No leave types are set up.</p>;
  }
  return (
    <Table aria-label="Leave balances">
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Entitled</TableHead>
          <TableHead className="hidden text-right md:table-cell">Carried</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Taken</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Pending</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => {
          const key = `${b.typeId}:${b.childId ?? ""}`;
          const expanded = open === key;
          return (
            <React.Fragment key={key}>
              <TableRow data-testid={`balance-${b.code}`}>
                <TableCell>
                  <button
                    type="button"
                    className="focus-ring flex flex-col items-start rounded-sm text-left"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : key)}
                  >
                    <span className="font-medium">
                      {b.name}
                      {b.childId ? (
                        <span className="text-primary-300"> · {childName(b.childId) ?? "Child"}</span>
                      ) : null}
                    </span>
                    {!b.eligible ? (
                      <span className="text-2xs text-primary-200">
                        {b.eligibleFrom ? `From ${dateLabel(b.eligibleFrom)}` : "Not eligible"}
                      </span>
                    ) : b.carryExpiresOn && b.carriedForward > 0 ? (
                      <span className="text-2xs text-primary-200">
                        Carried days expire {dateLabel(b.carryExpiresOn)}
                      </span>
                    ) : null}
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn("num font-semibold", (b.available ?? 0) <= 0 && "text-primary-200")}
                    data-testid="balance-available"
                  >
                    {fmt(b.available ?? 0)}
                  </span>
                  <span className="ml-1 text-2xs text-primary-200">{b.unit === "hours" ? "h" : "d"}</span>
                </TableCell>
                <TableCell className="num hidden text-right sm:table-cell">
                  {fmt(b.entitlement + b.adjustments)}
                </TableCell>
                <TableCell className="num hidden text-right md:table-cell">
                  {b.carriedForward ? fmt(b.carriedForward - b.expired) : "—"}
                </TableCell>
                <TableCell className="num hidden text-right sm:table-cell" data-testid="balance-taken">
                  {b.taken ? fmt(b.taken) : "—"}
                </TableCell>
                <TableCell className="num hidden text-right sm:table-cell">
                  {b.pending ? fmt(b.pending) : "—"}
                </TableCell>
              </TableRow>
              {expanded ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="bg-surface-100 py-3">
                    <p className="mb-1 font-azeret text-2xs uppercase tracking-wider text-primary-200">
                      How this is worked out
                    </p>
                    <ul className="flex list-disc flex-col gap-0.5 pl-4 text-ui text-primary-300">
                      {b.explanation.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                      {b.taken || b.pending ? (
                        <li>
                          {qty(b.taken, b.unit)} taken, {qty(b.pending, b.unit)} waiting for approval.
                        </li>
                      ) : null}
                    </ul>
                  </TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function dateLabel(iso: string) {
  return dateRange(iso, iso);
}

function MyRequests({ onOpen }: { onOpen: (id: string) => void }) {
  const me = useMe();
  const q = useQuery(requestsQuery({ employeeId: me.employeeId ?? undefined }));
  const items = q.data?.items ?? [];
  return (
    <Card aria-labelledby="mine-title" data-testid="my-leave-requests">
      <CardHeader>
        <CardTitle id="mine-title">My requests</CardTitle>
      </CardHeader>
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="border-t border-border p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-t border-border">
          <EmptyState
            variant="plain"
            icon={<CalendarX2 />}
            title="No leave requests yet"
            description="Requests you send appear here with their status. Approved ones are on the team calendar."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {items.map((r) => (
            <RequestRow key={r.id} r={r} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RequestRow({ r, onOpen }: { r: LeaveRequest; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(r.id)}
        data-testid="my-leave-request"
        className="focus-ring flex w-full flex-col gap-1 px-4 py-2.5 text-left hover:bg-surface-100 sm:flex-row sm:items-center sm:gap-4"
      >
        <span className="num min-w-0 flex-1 truncate text-ui">
          {dateRange(r.startDate, r.endDate, r.startSession, r.endSession)}
        </span>
        <span className="flex items-center justify-between gap-3 sm:contents">
          <span className="min-w-0 truncate text-ui sm:w-44">{r.type.name}</span>
          <span className="num whitespace-nowrap text-ui text-primary-300 sm:w-20 sm:text-right">
            {qty(r.quantity, r.unit)}
          </span>
          <span className="sm:w-28 sm:text-right">
            <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
          </span>
        </span>
      </button>
    </li>
  );
}

function Children() {
  const q = useQuery(childrenQuery());
  const [open, setOpen] = React.useState(false);
  const items = q.data?.items ?? [];
  return (
    <Card aria-labelledby="children-title" className="self-start" data-testid="leave-children">
      <CardHeader>
        <div>
          <CardTitle id="children-title">Children</CardTitle>
          <p className="mt-1 text-ui text-primary-300">
            For maternity, paternity, shared parental and childcare leave.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Baby /> Add
        </Button>
      </CardHeader>
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="border-t border-border p-4">
          <Skeleton className="h-6 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-ui text-primary-300">
          None recorded. Add a child (or an expected baby) to see your family leave.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {items.map((c) => (
            <ChildRow key={c.id} c={c} />
          ))}
        </ul>
      )}
      <ChildDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function ChildRow({ c }: { c: Child }) {
  const date = c.adoptionIntentDate ?? c.birthDate ?? c.expectedDeliveryDate;
  const what = c.adoptionIntentDate ? "Adoption from" : c.birthDate ? "Born" : "Due";
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-ui">
      <span className="min-w-0">
        <span className="block truncate font-medium">{c.name}</span>
        <span className="text-2xs text-primary-200">
          {what} <span className="num">{date ? dateLabel(date) : "—"}</span> · Child {c.birthOrder}
        </span>
      </span>
      <span className="text-2xs text-primary-300">{c.isCitizen ? "Singapore citizen" : "Not a citizen"}</span>
    </li>
  );
}

function ChildDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useLeaveInvalidate();
  const [name, setName] = React.useState("");
  const [how, setHow] = React.useState<"born" | "expected" | "adopting">("born");
  const [date, setDate] = React.useState<string | null>(null);
  const [adoptedBirthDate, setAdoptedBirthDate] = React.useState<string | null>(null);
  const [stillborn, setStillborn] = React.useState(false);
  const [isCitizen, setCitizen] = React.useState(true);
  const [order, setOrder] = React.useState("1");
  const [married, setMarried] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const reset = () => {
    setName("");
    setHow("born");
    setDate(null);
    setAdoptedBirthDate(null);
    setStillborn(false);
    setErrors({});
  };
  const save = useMutation({
    mutationFn: () =>
      apiPost<Child>("/api/v1/leave/children", {
        name: name.trim(),
        ...(how === "born"
          ? { birthDate: date, stillborn }
          : how === "expected"
            ? { expectedDeliveryDate: date }
            : { adoptionIntentDate: date, birthDate: adoptedBirthDate }),
        isCitizen,
        birthOrder: Number(order) || 1,
        marriedToMother: married,
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Child added. Family leave balances are updated.");
      reset();
      onOpenChange(false);
    },
    onError: (err) => setErrors(err instanceof ApiError ? err.fieldErrors : {}),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a child</DialogTitle>
          <DialogDescription>Used only to work out parental and childcare leave.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="Name" required error={errors.name} hint='Use "Baby" before the birth.'>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </FormField>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-300">
              This child
            </legend>
            <RadioGroup
              value={how}
              onValueChange={(v) => {
                setHow(v as typeof how);
                setStillborn(false);
              }}
              className="flex flex-col gap-2"
            >
              <RadioRow value="born">Has been born</RadioRow>
              <RadioRow value="expected">Is expected (not born yet)</RadioRow>
              <RadioRow value="adopting">Is being adopted</RadioRow>
            </RadioGroup>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={
                how === "born" ? "Date of birth" : how === "expected" ? "Expected delivery" : "Formal intent to adopt"
              }
              hint={how === "adopting" ? "The date of the formal intent to adopt, as on the MSF records." : undefined}
              required
              error={how === "adopting" ? (errors.adoptionIntentDate ?? errors.birthDate) : errors.birthDate}
            >
              <DatePicker value={date} onChange={setDate} />
            </FormField>
            <FormField label="Child number" hint="1 for your first child." error={errors.birthOrder}>
              <Input
                inputMode="numeric"
                className="num"
                value={order}
                onChange={(e) => setOrder(e.target.value.replace(/\D/g, ""))}
              />
            </FormField>
          </div>
          {how === "adopting" ? (
            <FormField
              label="Child's date of birth (optional)"
              hint="Adoption leave is for a child below 12 months old at the formal intent to adopt."
              error={errors.birthDate}
            >
              <DatePicker value={adoptedBirthDate} onChange={setAdoptedBirthDate} />
            </FormField>
          ) : null}
          {how === "born" ? (
            <div className="flex flex-col gap-1">
              <CheckRow checked={stillborn} onChange={setStillborn}>
                Our baby was stillborn
              </CheckRow>
              {stillborn ? (
                <p className="pl-6 text-2xs text-primary-300">
                  We're very sorry for your loss. Recording this keeps the leave you're still entitled to, such as 2
                  weeks of paternity leave for fathers. It's used only to work out leave.
                </p>
              ) : null}
            </div>
          ) : null}
          <CheckRow checked={isCitizen} onChange={setCitizen}>
            Singapore citizen (or will be within 12 months)
          </CheckRow>
          <CheckRow checked={married} onChange={setMarried}>
            Fathers: married to the child's mother (needed for paternity leave)
          </CheckRow>
          {save.error && !Object.keys(errors).length ? (
            <p className="text-ui text-danger-300">{save.error.message}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || !date || save.isPending}>
              Add child
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
