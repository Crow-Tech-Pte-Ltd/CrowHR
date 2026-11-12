import type { ChangeRequestDto } from "@crowhr/core";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  formatDate,
  StatusPill,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { ApiError } from "../../../lib/api.ts";
import { MobileAppSection } from "../../../me/mobile-app-section.tsx";
import { api, errorMessage, fieldErrors, invalidatePeople, meQuery, referenceQuery } from "../people/-lib/api.ts";
import { formatPhone } from "../people/-lib/format.ts";
import { ErrorPanel, Field, label, PanelSkeleton, Section, SelectInput, TextInput } from "../people/-lib/ui.tsx";

export const Route = createFileRoute("/_app/me/profile")({ component: MyProfilePage });

type Contact = { name: string; relationship: string; phone: string };

function MyProfilePage() {
  const q = useQuery(meQuery);
  const [editing, setEditing] = React.useState(false);
  const [requesting, setRequesting] = React.useState<null | "bank" | "personal">(null);
  if (q.isPending) return <PanelSkeleton rows={6} />;
  if (q.isError) {
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <>
        <PageHeader title="My profile" />
        <EmptyState title="Your sign-in isn't linked to an employee record." description={errorMessage(q.error)} />
        <div className="mt-6">
          <MobileAppSection />
        </div>
      </>
    ) : (
      <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
    );
  }
  const { employee: e, changeRequests } = q.data;
  const pending = changeRequests.filter((r) => r.status === "pending");
  const p = e.personal;
  return (
    <>
      <PageHeader
        title="My profile"
        description="Keep your contact details current. Changes to your legal details or bank account are checked by HR or payroll first."
        actions={
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit contact details
          </Button>
        }
      />
      {pending.length ? (
        <Alert variant="info" className="mb-4">
          <Clock aria-hidden />
          <div className="flex flex-col gap-1">
            <AlertTitle>Awaiting approval</AlertTitle>
            {pending.map((r) => (
              <PendingLine key={r.id} r={r} />
            ))}
          </div>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Contact">
          <dl>
            <Field term="Preferred name">{e.preferredName}</Field>
            <Field term="Work email">{e.workEmail}</Field>
            <Field term="Personal email">{p?.personalEmail}</Field>
            <Field term="Mobile" mono>
              {p?.mobile}
            </Field>
            <Field term="Address">
              {p?.address
                ? [p.address.block, p.address.street, p.address.unit, p.address.postalCode].filter(Boolean).join(", ")
                : null}
            </Field>
          </dl>
        </Section>
        <Section title="Emergency contacts">
          {e.emergencyContacts?.length ? (
            <dl>
              {e.emergencyContacts.map((c) => (
                <Field key={c.id} term={c.relationship}>
                  {c.name} · <span className="num">{formatPhone(c.phone)}</span>
                </Field>
              ))}
            </dl>
          ) : (
            <p className="py-3 text-ui text-primary-300">None yet. Add up to 3 people we can call in an emergency.</p>
          )}
        </Section>
        <Section
          title="Legal details"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setRequesting("personal")}>
              Request a change
            </Button>
          }
        >
          <dl>
            <Field term="Legal name">{e.legalName}</Field>
            <Field term={p?.idType === "fin" ? "FIN" : "NRIC"} mono>
              {p?.idNumberMasked}
            </Field>
            <Field term="Date of birth">{p ? formatDate(p.dob) : null}</Field>
            <Field term="Residency">{label(p?.residencyStatus)}</Field>
            <Field term="Race / religion">
              {label(p?.race)} · {label(p?.religion)}
            </Field>
          </dl>
        </Section>
        <Section
          title="Bank account"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setRequesting("bank")}>
              Request a change
            </Button>
          }
        >
          {e.bank?.current ? (
            <dl>
              <Field term="Bank">{e.bank.current.bankName}</Field>
              <Field term="Account" mono>
                ••••{e.bank.current.accountLast4}
              </Field>
              <Field term="Holder">{e.bank.current.holderName}</Field>
            </dl>
          ) : (
            <p className="py-3 text-ui text-primary-300">
              No bank account on record. Request one so salary can be paid by GIRO.
            </p>
          )}
        </Section>
      </div>
      <div className="mt-6">
        <MobileAppSection />
      </div>
      {editing ? <EditContactDialog e={e} onClose={() => setEditing(false)} /> : null}
      {requesting ? <RequestDialog kind={requesting} onClose={() => setRequesting(null)} /> : null}
    </>
  );
}

function PendingLine({ r }: { r: ChangeRequestDto }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api("POST", `/people/me/change-requests/${r.id}/cancel`),
    onSuccess: () => invalidatePeople(qc),
  });
  return (
    <AlertDescription className="flex flex-wrap items-center gap-2">
      <StatusPill tone="info">Awaiting {r.routeToRole === "payroll_admin" ? "payroll" : "HR"} approval</StatusPill>
      <span>
        {Object.entries(r.proposed)
          .map(([k, v]) => `${label(k.replace(/([A-Z])/g, "_$1").toLowerCase())}: ${v ?? "—"}`)
          .join(" · ")}
      </span>
      <Button size="sm" variant="link" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
        Withdraw
      </Button>
    </AlertDescription>
  );
}

function EditContactDialog({ e, onClose }: { e: NonNullable<ReturnType<typeof useMeData>>; onClose: () => void }) {
  const qc = useQueryClient();
  const p = e.personal;
  const [preferredName, setPreferredName] = React.useState(e.preferredName ?? "");
  const [personalEmail, setPersonalEmail] = React.useState(p?.personalEmail ?? "");
  const [mobile, setMobile] = React.useState(p?.mobile ?? "");
  const [postalCode, setPostalCode] = React.useState(p?.address?.postalCode ?? "");
  const [street, setStreet] = React.useState(p?.address?.street ?? "");
  const [contacts, setContacts] = React.useState<Contact[]>(
    (e.emergencyContacts ?? []).map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone })),
  );
  const save = useMutation({
    mutationFn: () =>
      api("PATCH", "/people/me/profile", {
        preferredName,
        personalEmail,
        mobile,
        address: { ...(p?.address ?? {}), street: street || null, postalCode: postalCode || null },
        emergencyContacts: contacts,
      }),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast("Saved", { description: "Your contact details are updated." });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit contact details</DialogTitle>
          <DialogDescription>Saved straight away. Your employer can see who changed what.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <TextInput
            label="Preferred name"
            value={preferredName}
            onChange={setPreferredName}
            error={errs.preferredName}
            hint="The name you go by. Leave empty to be called by your full name."
          />
          <TextInput
            label="Personal email"
            type="email"
            value={personalEmail}
            onChange={setPersonalEmail}
            error={errs.personalEmail}
          />
          <TextInput
            label="Mobile"
            mono
            inputMode="tel"
            value={mobile}
            onChange={setMobile}
            error={errs.mobile}
            hint="8-digit numbers are taken as +65."
          />
          <TextInput label="Street address" value={street} onChange={setStreet} error={errs["address.street"]} />
          <TextInput
            label="Postal code"
            mono
            inputMode="numeric"
            value={postalCode}
            onChange={setPostalCode}
            error={errs["address.postalCode"]}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className={cn("mb-1", textStyle.group)}>Emergency contacts</legend>
            {contacts.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: editable list without ids.
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[1fr_8rem_9rem_auto]">
                <TextInput
                  label="Name"
                  value={c.name}
                  onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                  error={errs[`emergencyContacts.${i}.name`]}
                />
                <TextInput
                  label="Relationship"
                  value={c.relationship}
                  onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, relationship: v } : x)))}
                  error={errs[`emergencyContacts.${i}.relationship`]}
                  className="hidden sm:flex"
                />
                <TextInput
                  label="Phone"
                  mono
                  value={c.phone}
                  onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, phone: v } : x)))}
                  error={errs[`emergencyContacts.${i}.phone`]}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${c.name || "contact"}`}
                  onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {contacts.length < 3 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => setContacts((cs) => [...cs, { name: "", relationship: "", phone: "" }])}
              >
                <Plus aria-hidden /> Add contact
              </Button>
            ) : (
              <p className="text-2xs text-primary-200">At most 3 emergency contacts.</p>
            )}
          </fieldset>
          {save.isError ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
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

function useMeData() {
  return useQuery(meQuery).data?.employee;
}

function RequestDialog({ kind, onClose }: { kind: "bank" | "personal"; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useQuery(referenceQuery);
  const [bankCode, setBankCode] = React.useState("");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [holderName, setHolderName] = React.useState("");
  const [legalName, setLegalName] = React.useState("");
  const save = useMutation({
    mutationFn: () =>
      api(
        "POST",
        "/people/me/change-requests",
        kind === "bank" ? { bank: { bankCode, accountNumber, holderName } } : { personal: { legalName } },
      ),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast("Request sent", {
        description:
          kind === "bank"
            ? "Payroll will review it. Your current account stays in use until then."
            : "HR will review it.",
      });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "bank" ? "Change bank account" : "Change legal name"}</DialogTitle>
          <DialogDescription>
            {kind === "bank"
              ? "A payroll admin approves bank changes. Salary keeps going to your current account until then."
              : "HR approves changes to legal details."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          {kind === "bank" ? (
            <>
              <SelectInput
                label="Bank"
                required
                value={bankCode}
                onChange={setBankCode}
                options={(ref.data?.banks ?? []).map((b) => ({ value: b.code, label: b.name }))}
                error={errs["bank.bankCode"]}
              />
              <TextInput
                label="Account number"
                required
                mono
                inputMode="numeric"
                value={accountNumber}
                onChange={setAccountNumber}
                error={errs["bank.accountNumber"]}
                autoComplete="off"
              />
              <TextInput
                label="Account holder name"
                required
                value={holderName}
                onChange={setHolderName}
                error={errs["bank.holderName"]}
              />
            </>
          ) : (
            <TextInput
              label="New legal name"
              required
              value={legalName}
              onChange={setLegalName}
              error={errs["personal.legalName"]}
              hint="As on your new NRIC or passport."
            />
          )}
          {save.isError && !Object.keys(errs).length ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
