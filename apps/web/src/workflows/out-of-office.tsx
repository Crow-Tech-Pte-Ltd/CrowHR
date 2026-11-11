import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  singaporeTodayIso,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { useMe } from "../auth/session.ts";
import { ApiError, apiDelete, apiPost } from "../lib/api.ts";
import { delegationsQuery, peopleQuery } from "./api.ts";

/**
 * Out-of-office cover: while it is on, the chosen person also gets your approval tasks and decides
 * "on behalf of" you. hr_admins and owners can set it for someone else (`forOthers`).
 */
export function OutOfOfficeDialog({
  open,
  onOpenChange,
  forOthers = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  forOthers?: boolean;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const people = useQuery({ ...peopleQuery, enabled: open });
  const existing = useQuery({ ...delegationsQuery(forOthers), enabled: open });
  const today = singaporeTodayIso();
  const [from, setFrom] = React.useState(me.membershipId);
  const [to, setTo] = React.useState("");
  const [startsOn, setStartsOn] = React.useState<string | null>(today);
  const [endsOn, setEndsOn] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setFrom(me.membershipId);
      setTo("");
      setStartsOn(today);
      setEndsOn(null);
      setErrors({});
    }
  }, [open, me.membershipId, today]);

  const save = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/approvals/delegations", {
        ...(forOthers && from !== me.membershipId ? { fromMembershipId: from } : {}),
        toMembershipId: to,
        startsOn,
        endsOn,
      }),
    onSuccess: () => {
      toast.success("Cover set", { description: "Approval tasks will also go to the person covering." });
      void qc.invalidateQueries({ queryKey: ["approvals", "delegations"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      setTo("");
      setEndsOn(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setErrors({ form: err instanceof Error ? err.message : "Not saved. Try again." });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/approvals/delegations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["approvals", "delegations"] }),
    onError: (err) => toast.error("Not removed", { description: err instanceof Error ? err.message : undefined }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!to) next.toMembershipId = "Choose who covers.";
    if (!startsOn) next.startsOn = "Pick the first day away.";
    if (!endsOn) next.endsOn = "Pick the last day away.";
    if (startsOn && endsOn && endsOn < startsOn) next.endsOn = "The last day must be on or after the first day.";
    if (to && to === from) next.toMembershipId = "Choose someone other than the person who is away.";
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  const choices = (people.data?.items ?? []).filter((p) => p.membershipId !== from);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{forOthers ? "Out-of-office cover" : "Out of office"}</DialogTitle>
          <DialogDescription>
            While cover is on, the person covering also gets {forOthers ? "their" : "your"} approval tasks and decides
            on {forOthers ? "their" : "your"} behalf. Role-based steps (HR admin, payroll admin, owner) only go to
            someone who holds that role.
          </DialogDescription>
        </DialogHeader>
        {existing.data?.items.length ? (
          <ul
            className="flex flex-col divide-y divide-border rounded-md border border-border"
            aria-label="Current cover"
          >
            {existing.data.items.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-ui">
                <span className="min-w-0">
                  <span className="font-medium">{d.from.name}</span> → {d.to.name}
                  <span className="num block text-2xs text-primary-300">
                    {formatDate(d.startsOn)} – {formatDate(d.endsOn)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {d.active ? <StatusPill tone="info">On now</StatusPill> : <StatusPill>Upcoming</StatusPill>}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove cover from ${d.from.name} to ${d.to.name}`}
                    onClick={() => remove.mutate(d.id)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {forOthers ? (
            <FormField label="Who is away">
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger aria-label="Who is away">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(people.data?.items ?? []).map((p) => (
                    <SelectItem key={p.membershipId} value={p.membershipId}>
                      {p.name}
                      {p.membershipId === me.membershipId ? " (you)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField label="Who covers" error={errors.toMembershipId}>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger aria-label="Who covers">
                <SelectValue placeholder="Choose a colleague" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((p) => (
                  <SelectItem key={p.membershipId} value={p.membershipId}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="First day away" error={errors.startsOn}>
              <DatePicker value={startsOn} onChange={setStartsOn} min={today} />
            </FormField>
            <FormField label="Last day away" error={errors.endsOn} hint="Both days included.">
              <DatePicker value={endsOn} onChange={setEndsOn} min={startsOn ?? today} />
            </FormField>
          </div>
          {errors.form ? (
            <p role="alert" className="text-ui text-danger-300">
              {errors.form}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Set cover
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
