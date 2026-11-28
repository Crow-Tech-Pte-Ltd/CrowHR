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
  DialogTrigger,
  FormField,
  formatDate,
  Input,
  RadioGroup,
  Skeleton,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Baby, Pencil } from "lucide-react";
import * as React from "react";
import { canForEmployee, useMe } from "../auth/session.ts";
import { ErrorNote } from "../components/section.tsx";
import { useT } from "../i18n/index.ts";
import { ApiError, apiPost, apiPut } from "../lib/api.ts";
import { type Child, childrenQuery, useLeaveInvalidate } from "./api.ts";
import { CheckRow, RadioRow } from "./choice.tsx";

export function ChildRecords({ employeeId }: { employeeId?: string }) {
  const tWorkflow = useT("workflows");
  const me = useMe();
  const target = employeeId ?? me.employeeId;
  const canRead =
    !!target && canForEmployee(me, "personal_details:read", target) && canForEmployee(me, "leave:read", target);
  const canEdit = !!target && canForEmployee(me, "leave:create", target);
  const q = useQuery({ ...childrenQuery(employeeId), enabled: canRead && canEdit });
  const titleId = React.useId();
  if (!canRead || !canEdit) return null;
  return (
    <Card aria-labelledby={titleId} className="self-start" data-testid="leave-children">
      <CardHeader>
        <div>
          <CardTitle id={titleId}>{tWorkflow("Children")}</CardTitle>
          <p className="mt-1 text-ui text-primary-300">
            {tWorkflow("For maternity, paternity, shared parental and childcare leave.")}
          </p>
        </div>
        <ChildDialog employeeId={employeeId} />
      </CardHeader>
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="border-t border-border p-4">
          <Skeleton className="h-6 w-full" />
        </div>
      ) : q.data.items.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-ui text-primary-300">
          {tWorkflow("No children recorded. Add a child or an expected baby to calculate family leave.")}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {q.data.items.map((child) => (
            <ChildRow key={child.id} child={child} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChildRow({ child }: { child: Child }) {
  const tWorkflow = useT("workflows");
  const date = child.adoptionIntentDate ?? child.birthDate ?? child.expectedDeliveryDate;
  const what = child.adoptionIntentDate ? "Adoption from" : child.birthDate ? "Born" : "Due";
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5 text-ui">
      <div className="min-w-0">
        <span className="block break-words font-medium">{child.name}</span>
        <div className="text-2xs text-primary-200">
          {what} <span className="num">{date ? formatDate(date) : "—"}</span> {tWorkflow("· Child")} {child.birthOrder}
          <span className="block text-primary-300">
            {child.isCitizen ? tWorkflow("Singapore citizen") : tWorkflow("Not a citizen")}
          </span>
        </div>
      </div>
      <ChildDialog child={child} />
    </li>
  );
}

type ChildStatus = "born" | "expected" | "adopting";

function childStatus(child?: Child): ChildStatus {
  if (child?.adoptionIntentDate) return "adopting";
  if (child?.birthDate) return "born";
  return child?.expectedDeliveryDate ? "expected" : "born";
}

function ChildDialog({ child, employeeId }: { child?: Child; employeeId?: string }) {
  const tWorkflow = useT("workflows");
  const invalidate = useLeaveInvalidate();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [how, setHow] = React.useState<ChildStatus>("born");
  const [date, setDate] = React.useState<string | null>(null);
  const [adoptedBirthDate, setAdoptedBirthDate] = React.useState<string | null>(null);
  const [stillborn, setStillborn] = React.useState(false);
  const [isCitizen, setCitizen] = React.useState(true);
  const [order, setOrder] = React.useState("1");
  const [married, setMarried] = React.useState<boolean | null>(true);
  function reset() {
    setName(child?.name ?? "");
    setHow(childStatus(child));
    setDate(child?.adoptionIntentDate ?? child?.birthDate ?? child?.expectedDeliveryDate ?? null);
    setAdoptedBirthDate(child?.adoptionIntentDate ? child.birthDate : null);
    setStillborn(child?.stillborn ?? false);
    setCitizen(child?.isCitizen ?? true);
    setOrder(String(child?.birthOrder ?? 1));
    setMarried(child ? child.marriedToMother : true);
    save.reset();
  }
  const save = useMutation({
    mutationFn: () => {
      const sameStatus = !!child && childStatus(child) === how;
      const body = {
        name: name.trim(),
        birthDate: how === "born" ? date : how === "adopting" ? adoptedBirthDate : null,
        adoptionIntentDate: how === "adopting" ? date : null,
        expectedDeliveryDate: how === "expected" ? date : sameStatus ? child?.expectedDeliveryDate : null,
        stillborn: how === "born" ? stillborn : sameStatus && stillborn,
        isCitizen,
        birthOrder: Number(order),
        marriedToMother: married,
      };
      return child
        ? apiPut<Child>(`/api/v1/leave/children/${child.id}`, body)
        : apiPost<Child>("/api/v1/leave/children", { ...body, employeeId });
    },
    onSuccess: () => {
      invalidate();
      toast.success(
        child ? tWorkflow("Child details updated.") : tWorkflow("Child added. Family leave balances are updated."),
      );
      setOpen(false);
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const valid = name.trim() && date && Number(order) >= 1 && Number(order) <= 20;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {child ? (
          <Button size="sm" variant="ghost" aria-label={tWorkflow("Edit {arg1}", { arg1: child.name })}>
            <Pencil aria-hidden /> {tWorkflow("Edit")}
          </Button>
        ) : (
          <Button size="sm">
            <Baby aria-hidden /> {tWorkflow("Add child")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{child ? tWorkflow("Edit child") : tWorkflow("Add a child")}</DialogTitle>
          <DialogDescription>{tWorkflow("Used only to work out parental and childcare leave.")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !save.isPending) save.mutate();
          }}
        >
          <FormField
            label={tWorkflow("Name")}
            required
            error={errors.name}
            hint={tWorkflow('Use "Baby" before the birth.')}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </FormField>
          <fieldset className="flex flex-col gap-2">
            <legend className={cn("mb-1", textStyle.group)}>{tWorkflow("This child")}</legend>
            <RadioGroup
              value={how}
              onValueChange={(v) => {
                const next = v as ChildStatus;
                if (next === how) return;
                const original = childStatus(child) === next;
                setHow(next);
                setDate(
                  original
                    ? (child?.adoptionIntentDate ?? child?.birthDate ?? child?.expectedDeliveryDate ?? null)
                    : null,
                );
                setAdoptedBirthDate(next === "adopting" ? (child?.birthDate ?? null) : null);
                setStillborn(original && !!child?.stillborn);
              }}
              className="flex flex-col gap-2"
            >
              <RadioRow value="born">{tWorkflow("Has been born")}</RadioRow>
              <RadioRow value="expected">{tWorkflow("Is expected (not born yet)")}</RadioRow>
              <RadioRow value="adopting">{tWorkflow("Is being adopted")}</RadioRow>
            </RadioGroup>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={
                how === "born"
                  ? tWorkflow("Date of birth")
                  : how === "expected"
                    ? tWorkflow("Expected delivery")
                    : tWorkflow("Formal intent to adopt")
              }
              hint={
                how === "adopting"
                  ? tWorkflow("The date of the formal intent to adopt, as on the MSF records.")
                  : undefined
              }
              required
              error={
                how === "expected"
                  ? (errors.expectedDeliveryDate ?? errors.birthDate)
                  : how === "adopting"
                    ? errors.adoptionIntentDate
                    : errors.birthDate
              }
            >
              <DatePicker value={date} onChange={setDate} yearPicker />
            </FormField>
            <FormField
              label={tWorkflow("Child number")}
              hint={tWorkflow("1 for the first child.")}
              error={errors.birthOrder}
              required
            >
              <Input
                type="number"
                min={1}
                max={20}
                className="num"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </FormField>
          </div>
          {how === "adopting" ? (
            <FormField
              label={tWorkflow("Child's date of birth (optional)")}
              hint={tWorkflow("Adoption leave is for a child below 12 months old at the formal intent to adopt.")}
              error={errors.birthDate}
            >
              <DatePicker value={adoptedBirthDate} onChange={setAdoptedBirthDate} yearPicker />
            </FormField>
          ) : null}
          {how === "born" ? (
            <div className="flex flex-col gap-1">
              <CheckRow checked={stillborn} onChange={setStillborn}>
                {tWorkflow("The baby was stillborn")}
              </CheckRow>
              {stillborn ? (
                <p className="pl-6 text-2xs text-primary-300">
                  {tWorkflow("This record helps work out the parental leave that applies.")}
                </p>
              ) : null}
            </div>
          ) : null}
          <CheckRow checked={isCitizen} onChange={setCitizen}>
            {tWorkflow("Singapore citizen (or will be within 12 months)")}
          </CheckRow>
          <CheckRow checked={married === true} onChange={setMarried}>
            {tWorkflow("Father is married to the child's mother (needed for paternity leave)")}
          </CheckRow>
          {save.error && !Object.keys(errors).length ? (
            <p className="text-ui text-danger-300" role="alert">
              {save.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={save.isPending}>
              {tWorkflow("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
              {child ? tWorkflow("Save child") : tWorkflow("Add child")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
