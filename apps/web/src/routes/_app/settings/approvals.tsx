import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatDate,
  Input,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Plane, Plus, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote, Section } from "../../../components/section.tsx";
import { ApiError, apiPut } from "../../../lib/api.ts";
import { delegationsQuery, type Policy, type PolicyType, peopleQuery, policiesQuery } from "../../../workflows/api.ts";
import { thresholdLabel } from "../../../workflows/format.ts";
import { OutOfOfficeDialog } from "../../../workflows/out-of-office.tsx";

export const Route = createFileRoute("/_app/settings/approvals")({
  component: ApprovalSettingsPage,
});

const RULES = [
  { value: "manager", label: "Their manager" },
  { value: "manager_of_manager", label: "Their manager's manager" },
  { value: "role:hr_admin", label: "Any HR admin" },
  { value: "role:payroll_admin", label: "Any payroll admin" },
  { value: "role:owner", label: "Any owner" },
  { value: "member", label: "A specific person…" },
] as const;

/** Types where an amount threshold makes sense in the editor. */
const AMOUNT_TYPES = new Set(["claim", "overtime", "timesheet"]);

interface DraftStep {
  key: string;
  rule: string;
  memberId: string;
  escalateAfterDays: string;
}
interface DraftPolicy {
  key: string;
  name: string;
  condition: Policy["condition"];
  priority: number;
  steps: DraftStep[];
}

let seq = 0;
const k = () => `k${++seq}`;

function toDraft(p: Policy): DraftPolicy {
  return {
    key: k(),
    name: p.name,
    condition: p.condition,
    priority: p.priority,
    steps: p.steps.map((s) => ({
      key: k(),
      rule: s.approverRule.startsWith("member:") ? "member" : s.approverRule,
      memberId: s.approverRule.startsWith("member:") ? s.approverRule.slice(7) : "",
      escalateAfterDays: String(s.escalateAfterDays),
    })),
  };
}

function defaultDraft(type: string): DraftPolicy {
  const steps =
    type === "payroll_run"
      ? ["role:owner"]
      : type === "profile_change"
        ? ["role:hr_admin"]
        : ["manager", "role:hr_admin"];
  return {
    key: k(),
    name: "Default",
    condition: null,
    priority: 0,
    steps: steps.map((rule) => ({ key: k(), rule, memberId: "", escalateAfterDays: "3" })),
  };
}

function ApprovalSettingsPage() {
  const me = useMe();
  const policies = useQuery(policiesQuery);
  const [editing, setEditing] = React.useState<PolicyType | null>(null);
  const [coverOpen, setCoverOpen] = React.useState(false);
  const canManageCover = can(me, "approval_delegations:manage");
  const cover = useQuery({ ...delegationsQuery(true), enabled: canManageCover });

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Approvals"
        description="Who approves what. Requests go through the steps in order, and anyone in a step can decide. Requests already sent keep the chain they started with."
      />
      {!can(me, "policies:read") ? (
        <Alert variant="info" className="mb-6">
          <AlertDescription>Only owners and HR admins can change approval chains.</AlertDescription>
        </Alert>
      ) : null}

      <Section
        id="chains"
        title="Approval chains"
        description="Sensible defaults are already on: a manager approves first, then HR. If someone has no manager, or would approve their own request, that step is skipped."
      >
        {policies.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading approval chains">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : policies.isError ? (
          <ErrorNote error={policies.error} retry={() => void policies.refetch()} />
        ) : (
          <ul className="divide-y divide-border" data-testid="approval-chains">
            {policies.data.types.map((t) => (
              <TypeRow key={t.subjectType} type={t} onEdit={() => setEditing(t)} />
            ))}
          </ul>
        )}
      </Section>

      {canManageCover ? (
        <Section
          id="cover"
          title="Out-of-office cover"
          description="While someone is away, a colleague also gets their approval tasks and decides on their behalf."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setCoverOpen(true)}>
              <Plane /> Set cover
            </Button>
          }
        >
          {cover.isPending ? (
            <div className="p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : cover.isError ? (
            <ErrorNote error={cover.error} retry={() => void cover.refetch()} />
          ) : cover.data.items.length === 0 ? (
            <p className="px-4 py-4 text-ui text-primary-300">
              Nobody is away. Members can also set their own cover from the Inbox.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {cover.data.items.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-ui">
                  <span>
                    <span className="font-medium">{d.from.name}</span> is covered by{" "}
                    <span className="font-medium">{d.to.name}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num text-2xs text-primary-300">
                      {formatDate(d.startsOn)} – {formatDate(d.endsOn)}
                    </span>
                    {d.active ? <StatusPill tone="info">On now</StatusPill> : <StatusPill>Upcoming</StatusPill>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {editing ? <ChainEditor type={editing} onClose={() => setEditing(null)} /> : null}
      <OutOfOfficeDialog open={coverOpen} onOpenChange={setCoverOpen} forOthers />
    </>
  );
}

function Chain({ steps }: { steps: Policy["steps"] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a static, ordered list of steps without IDs.
        <React.Fragment key={`${i}-${s.approverRule}`}>
          {i > 0 ? <ArrowRight className="size-3 text-primary-200" aria-label="then" /> : null}
          <Badge>{s.label}</Badge>
        </React.Fragment>
      ))}
    </span>
  );
}

function escalationText(p: Policy) {
  const days = [...new Set(p.steps.map((s) => s.escalateAfterDays))];
  if (days.length === 1) return days[0] === 0 ? "No escalation" : `Escalates after ${days[0]} days`;
  return "Escalation varies by step";
}

function conditionText(p: Policy) {
  if (!p.condition) return null;
  const parts = [];
  if (p.condition.amountGte !== undefined) parts.push(thresholdLabel(p.condition.amountGte));
  if (p.condition.typeCodes) parts.push(`types: ${p.condition.typeCodes.join(", ")}`);
  return parts.join(" and ");
}

function TypeRow({ type, onEdit }: { type: PolicyType; onEdit: () => void }) {
  const def = type.policies.find((p) => p.isDefault) ?? type.policies[0];
  const rules = type.policies.filter((p) => !p.isDefault);
  return (
    <li
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
      data-testid={`chain-${type.subjectType}`}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-azeret text-xs font-semibold">{type.label}</span>
          {type.ownerOnly ? <Badge variant="muted">Owner only</Badge> : null}
          {!type.installed ? (
            <span className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">Not in use yet</span>
          ) : null}
        </p>
        {def ? (
          <div className="flex flex-wrap items-center gap-2 text-2xs text-primary-300">
            <Chain steps={def.steps} />
            <span>· {escalationText(def)}</span>
          </div>
        ) : null}
        {rules.map((r) => (
          <div key={r.id ?? r.name} className="flex flex-wrap items-center gap-2 text-2xs text-primary-300">
            <span className="num font-medium text-ink">{conditionText(r)}:</span>
            <Chain steps={r.steps} />
          </div>
        ))}
      </div>
      {type.canEdit ? (
        <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${type.label} approvals`}>
          Edit
        </Button>
      ) : (
        <span className="text-2xs text-primary-200">Only an owner can change this</span>
      )}
    </li>
  );
}

function ChainEditor({ type, onClose }: { type: PolicyType; onClose: () => void }) {
  const qc = useQueryClient();
  const people = useQuery(peopleQuery);
  const initial = React.useMemo(() => {
    const drafts = type.policies.map(toDraft);
    if (!drafts.some((d) => d.condition === null)) drafts.unshift(defaultDraft(type.subjectType));
    return drafts.sort((a, b) => (a.condition === null ? -1 : b.condition === null ? 1 : a.priority - b.priority));
  }, [type]);
  const [drafts, setDrafts] = React.useState<DraftPolicy[]>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const update = (key: string, fn: (d: DraftPolicy) => DraftPolicy) =>
    setDrafts((all) => all.map((d) => (d.key === key ? fn(d) : d)));

  const thresholds = [
    ...new Set(drafts.flatMap((d) => (d.condition?.amountGte !== undefined ? [d.condition.amountGte] : []))),
  ].sort((a, b) => a - b);
  const amountRank = (cents: number) => 10 * (thresholds.indexOf(cents) + 1);
  const save = useMutation({
    mutationFn: () =>
      apiPut(`/api/v1/approvals/policies/${type.subjectType}`, {
        policies: drafts.map((d, i) => ({
          name: d.condition ? d.name || `Rule ${i}` : "Default",
          condition: d.condition,
          // A higher threshold wins over a lower one (both match a large amount).
          priority: d.condition?.amountGte !== undefined ? amountRank(d.condition.amountGte) : d.priority,
          steps: d.steps.map((s) => ({
            approverRule: s.rule === "member" ? `member:${s.memberId}` : s.rule,
            escalateAfterDays: Number(s.escalateAfterDays || 0),
          })),
        })),
      }),
    onSuccess: () => {
      toast.success(`${type.label} approvals saved`, { description: "New requests use this chain from now on." });
      void qc.invalidateQueries({ queryKey: ["approvals", "policies"] });
      onClose();
    },
    onError: (err) => {
      const issues = err instanceof ApiError ? Object.values(err.fieldErrors) : [];
      setError(issues[0] ?? (err instanceof Error ? err.message : "Not saved. Try again."));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const d of drafts) {
      if (!d.steps.length) return setError("Every chain needs at least one step.");
      if (d.steps.some((s) => s.rule === "member" && !s.memberId))
        return setError("Choose the person for each “specific person” step.");
      if (d.steps.some((s) => !/^\d{1,2}$/.test(s.escalateAfterDays) || Number(s.escalateAfterDays) > 60))
        return setError("Escalation is a whole number of days from 0 (off) to 60.");
      if (d.condition && d.condition.amountGte === undefined && !d.condition.typeCodes)
        return setError("Enter the amount for each rule, or remove the rule.");
    }
    setError(null);
    save.mutate();
  };

  const amountRules = AMOUNT_TYPES.has(type.subjectType) || drafts.some((d) => d.condition?.amountGte !== undefined);
  const noun = type.label.toLowerCase();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Who approves {noun}?</DialogTitle>
            <DialogDescription>
              Steps run in order. Anyone in a step can decide; the first decision counts. If nobody acts, the request
              escalates one level up after the number of days you set.
            </DialogDescription>
          </DialogHeader>
          {drafts.map((d) => (
            <fieldset
              key={d.key}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
              data-testid="policy-draft"
            >
              <legend className="px-1 font-azeret text-2xs font-semibold uppercase tracking-wider">
                {d.condition === null ? "Normally" : "Larger amounts"}
              </legend>
              {d.condition !== null && d.condition.amountGte !== undefined ? (
                <div className="flex flex-wrap items-center gap-2 text-ui">
                  When the amount is
                  <MoneyInput
                    className="w-36"
                    aria-label="Amount threshold"
                    value={d.condition.amountGte ?? null}
                    onChange={(cents) =>
                      update(d.key, (x) => ({ ...x, condition: { ...x.condition, amountGte: cents ?? undefined } }))
                    }
                  />
                  or more
                </div>
              ) : d.condition?.typeCodes ? (
                <p className="text-ui text-primary-300">For types: {d.condition.typeCodes.join(", ")}</p>
              ) : null}
              <ol className="flex flex-col gap-2">
                {d.steps.map((s, i) => (
                  <li
                    key={s.key}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:grid-cols-[auto_1fr_auto_auto]"
                  >
                    <span className="num w-12 font-azeret text-2xs text-primary-200">Step {i + 1}</span>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <Select
                        value={s.rule}
                        onValueChange={(rule) =>
                          update(d.key, (x) => ({
                            ...x,
                            steps: x.steps.map((y) => (y.key === s.key ? { ...y, rule } : y)),
                          }))
                        }
                      >
                        <SelectTrigger aria-label={`Step ${i + 1} approver`} className="sm:w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {s.rule === "member" ? (
                        <Select
                          value={s.memberId}
                          onValueChange={(memberId) =>
                            update(d.key, (x) => ({
                              ...x,
                              steps: x.steps.map((y) => (y.key === s.key ? { ...y, memberId } : y)),
                            }))
                          }
                        >
                          <SelectTrigger aria-label={`Step ${i + 1} person`} className="sm:w-48">
                            <SelectValue placeholder="Choose a person" />
                          </SelectTrigger>
                          <SelectContent>
                            {(people.data?.items ?? []).map((p) => (
                              <SelectItem key={p.membershipId} value={p.membershipId}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                    <div className="col-start-2 flex items-center gap-1.5 text-2xs text-primary-300 sm:col-start-auto">
                      Escalate after
                      <Input
                        inputMode="numeric"
                        className="num h-8 w-12 text-right"
                        aria-label={`Step ${i + 1} escalate after days`}
                        value={s.escalateAfterDays}
                        onChange={(e) =>
                          update(d.key, (x) => ({
                            ...x,
                            steps: x.steps.map((y) =>
                              y.key === s.key
                                ? { ...y, escalateAfterDays: e.target.value.replace(/\D/g, "").slice(0, 2) }
                                : y,
                            ),
                          }))
                        }
                      />
                      days
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove step ${i + 1}`}
                      disabled={d.steps.length === 1}
                      onClick={() => update(d.key, (x) => ({ ...x, steps: x.steps.filter((y) => y.key !== s.key) }))}
                      className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto"
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={d.steps.length >= 5}
                  onClick={() =>
                    update(d.key, (x) => ({
                      ...x,
                      steps: [...x.steps, { key: k(), rule: "role:owner", memberId: "", escalateAfterDays: "3" }],
                    }))
                  }
                >
                  <Plus /> Add a step
                </Button>
                {d.condition !== null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                  >
                    <Trash2 /> Remove this rule
                  </Button>
                ) : null}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            {amountRules ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  setDrafts((all) => [
                    ...all,
                    {
                      key: k(),
                      name: "Larger amounts",
                      condition: { amountGte: 50_000 },
                      priority: 500,
                      steps: [
                        { key: k(), rule: "manager", memberId: "", escalateAfterDays: "3" },
                        { key: k(), rule: "role:owner", memberId: "", escalateAfterDays: "3" },
                      ],
                    },
                  ])
                }
              >
                <Plus /> Add a rule for larger amounts
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => setDrafts([defaultDraft(type.subjectType)])}>
              <RotateCcw /> Back to the default
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-ui text-danger-300">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
