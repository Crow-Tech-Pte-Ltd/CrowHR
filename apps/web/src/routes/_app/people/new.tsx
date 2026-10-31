import { Alert, AlertDescription, AlertTitle, Button, FormField, MoneyInput, toast } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, UserPlus } from "lucide-react";
import * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { LinkDialog } from "../../../settings/members-dialogs.tsx";
import {
  api,
  directoryQuery,
  errorCode,
  errorDetails,
  errorMessage,
  fieldErrors,
  invalidatePeople,
  referenceQuery,
  schedulesQuery,
  structureQuery,
} from "./-lib/api.ts";
import { DateInput, label, SelectInput, TextInput, today } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/people/new")({ component: NewEmployeePage });

const blank = {
  legalName: "",
  preferredName: "",
  idType: "nric",
  idNumber: "",
  dob: "",
  gender: "",
  nationality: "",
  residencyStatus: "citizen",
  prStartDate: "",
  race: "",
  religion: "",
  workEmail: "",
  mobile: "",
  hireDate: today(),
  jobTitle: "",
  departmentId: "",
  teamId: "",
  locationId: "",
  managerEmployeeId: "",
  employmentType: "full_time",
  workScheduleId: "",
  probationEnd: "",
  payBasis: "monthly",
  passType: "",
  passNumber: "",
  passIssuedOn: "",
  passExpiresOn: "",
};
type Form = typeof blank;

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

function NewEmployeePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = React.useState<Form>(blank);
  const [amount, setAmount] = React.useState<number | null>(null);
  // Without SMTP the hire returns a one-time sign-in link: show it once, then open the record.
  const [invite, setInvite] = React.useState<{ employeeId: string; url: string; body: string } | null>(null);
  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const ref = useQuery(referenceQuery);
  const departments = useQuery(structureQuery("departments"));
  const teams = useQuery(structureQuery("teams"));
  const locations = useQuery(structureQuery("locations"));
  const schedules = useQuery(schedulesQuery);
  const people = useQuery(directoryQuery({ status: "active,leaving,not_started" }));
  const foreigner = f.residencyStatus === "foreigner";

  const save = useMutation({
    mutationFn: () =>
      api<{ employeeId: string; invite: HireInvite | null }>("POST", "/employees", {
        person: {
          legalName: f.legalName,
          preferredName: orNull(f.preferredName),
          idType: f.idType,
          idNumber: f.idNumber,
          dob: f.dob,
          gender: orNull(f.gender),
          nationality: orNull(f.nationality),
          residencyStatus: f.residencyStatus,
          prStartDate: f.residencyStatus === "pr" ? orNull(f.prStartDate) : null,
          race: orNull(f.race),
          religion: orNull(f.religion),
          workEmail: orNull(f.workEmail),
          mobile: orNull(f.mobile),
        },
        job: {
          hireDate: f.hireDate,
          jobTitle: f.jobTitle,
          departmentId: f.departmentId,
          teamId: orNull(f.teamId),
          locationId: orNull(f.locationId),
          managerEmployeeId: orNull(f.managerEmployeeId),
          employmentType: f.employmentType,
          workScheduleId: orNull(f.workScheduleId),
          probationEnd: orNull(f.probationEnd),
        },
        compensation: amount === null ? null : { payBasis: f.payBasis, amountCents: amount },
        workPass:
          foreigner && f.passType
            ? {
                passType: f.passType,
                passNumber: orNull(f.passNumber),
                issuedOn: orNull(f.passIssuedOn),
                expiresOn: f.passExpiresOn,
              }
            : null,
      }),
    onSuccess: async ({ employeeId, invite: sent }) => {
      await invalidatePeople(qc);
      if (sent?.status === "link" && sent.inviteUrl) {
        setInvite({ employeeId, url: sent.inviteUrl, body: sent.message });
        return;
      }
      if (sent)
        toast(sent.status === "skipped" ? "Employee added; no invitation sent" : "Employee added", {
          description: sent.message,
        });
      void navigate({ to: "/people/$employeeId", params: { employeeId } });
    },
  });
  const errs = fieldErrors(save.error);
  const e = (path: string) => errs[path];
  const dup =
    errorCode(save.error) === "duplicate_id_number" ? errorDetails<{ existingEmployeeId?: string }>(save.error) : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "People", to: "/people" }]}
        title="Add employee"
        description="The essentials for payroll and sign-in. You can fill in the rest from their profile later."
      />
      <form
        className="flex max-w-4xl flex-col gap-6"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          save.mutate();
        }}
      >
        {save.isError ? (
          <Alert variant="danger">
            <AlertTriangle aria-hidden />
            <div>
              <AlertTitle>{dup ? "This person is already on record" : "Check the highlighted fields"}</AlertTitle>
              <AlertDescription>
                {Object.keys(errs).length ? "Each problem is shown next to its field below." : errorMessage(save.error)}{" "}
                {dup?.existingEmployeeId ? (
                  <Link
                    className="font-medium text-biru-400 underline"
                    to="/people/$employeeId"
                    params={{ employeeId: dup.existingEmployeeId }}
                  >
                    Open their record
                  </Link>
                ) : null}
              </AlertDescription>
            </div>
          </Alert>
        ) : null}

        <FormSection title="Person" description="As on the NRIC, FIN card or passport.">
          <TextInput
            label="Legal name"
            required
            value={f.legalName}
            onChange={set("legalName")}
            error={e("person.legalName")}
            autoComplete="off"
          />
          <TextInput
            label="Preferred name"
            value={f.preferredName}
            onChange={set("preferredName")}
            error={e("person.preferredName")}
            hint="Shown in the directory."
          />
          <SelectInput
            label="Residency"
            required
            value={f.residencyStatus}
            onChange={(v) =>
              setF((s) => ({
                ...s,
                residencyStatus: v,
                idType: v === "foreigner" ? "fin" : s.idType === "fin" && v !== "pr" ? "nric" : s.idType,
              }))
            }
            options={["citizen", "pr", "foreigner"].map((v) => ({ value: v, label: label(v) }))}
            error={e("person.residencyStatus")}
          />
          {f.residencyStatus === "pr" ? (
            <DateInput
              label="PR start date"
              required
              value={f.prStartDate}
              onChange={set("prStartDate")}
              error={e("person.prStartDate")}
              hint="The SPR status date on the ICA entry permit. CPF rates depend on it."
            />
          ) : null}
          <SelectInput
            label="ID type"
            required
            value={f.idType}
            onChange={set("idType")}
            options={["nric", "fin", "other"].map((v) => ({ value: v, label: label(v) }))}
            error={e("person.idType")}
          />
          <TextInput
            label={f.idType === "other" ? "Passport number" : f.idType.toUpperCase()}
            required
            mono
            value={f.idNumber}
            onChange={set("idNumber")}
            error={e("person.idNumber")}
            placeholder={f.idType === "fin" ? "G1234567X" : "S1234567D"}
            autoComplete="off"
            hint="Stored encrypted and shown masked."
          />
          <DateInput label="Date of birth" required value={f.dob} onChange={set("dob")} error={e("person.dob")} />
          <SelectInput
            label="Gender"
            value={f.gender}
            onChange={set("gender")}
            options={(ref.data?.genders ?? []).map((v) => ({ value: v, label: label(v) }))}
            error={e("person.gender")}
          />
          <TextInput
            label="Nationality"
            value={f.nationality}
            onChange={set("nationality")}
            error={e("person.nationality")}
            placeholder="Singaporean"
          />
          <SelectInput
            label="Race"
            value={f.race}
            onChange={set("race")}
            options={(ref.data?.races ?? []).map((v) => ({ value: v, label: label(v) }))}
            error={e("person.race")}
            hint="As on the NRIC. Decides the SHG fund (CDAC, ECF, SINDA)."
          />
          <SelectInput
            label="Religion"
            value={f.religion}
            onChange={set("religion")}
            options={(ref.data?.religions ?? []).map((v) => ({ value: v, label: label(v) }))}
            error={e("person.religion")}
            hint="Muslims contribute to MBMF."
          />
        </FormSection>

        <FormSection title="Contact" description="The work email gets the sign-in invitation.">
          <TextInput
            label="Work email"
            type="email"
            value={f.workEmail}
            onChange={set("workEmail")}
            error={e("person.workEmail")}
            autoComplete="off"
          />
          <TextInput
            label="Mobile"
            inputMode="tel"
            mono
            value={f.mobile}
            onChange={set("mobile")}
            error={e("person.mobile")}
            placeholder="9123 4567"
            hint="8-digit numbers are taken as +65."
          />
        </FormSection>

        <FormSection title="Job">
          <DateInput
            label="Start date"
            required
            value={f.hireDate}
            onChange={set("hireDate")}
            error={e("job.hireDate")}
          />
          <TextInput
            label="Job title"
            required
            value={f.jobTitle}
            onChange={set("jobTitle")}
            error={e("job.jobTitle")}
          />
          <SelectInput
            label="Department"
            required
            value={f.departmentId}
            onChange={set("departmentId")}
            options={(departments.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
            error={e("job.departmentId")}
            hint={
              departments.data?.items.length === 0 ? (
                <Link className="text-biru-400 underline" to="/settings/structure">
                  Add a department first
                </Link>
              ) : undefined
            }
          />
          <SelectInput
            label="Team"
            value={f.teamId}
            onChange={set("teamId")}
            options={(teams.data?.items ?? []).filter((d) => !d.archived).map((d) => ({ value: d.id, label: d.name }))}
            error={e("job.teamId")}
          />
          <SelectInput
            label="Location"
            value={f.locationId}
            onChange={set("locationId")}
            options={(locations.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
            error={e("job.locationId")}
          />
          <SelectInput
            label="Manager"
            value={f.managerEmployeeId}
            onChange={set("managerEmployeeId")}
            options={(people.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.jobTitle ?? ""}` }))}
            error={e("job.managerEmployeeId")}
          />
          <SelectInput
            label="Employment type"
            required
            value={f.employmentType}
            onChange={set("employmentType")}
            options={(ref.data?.employmentTypes ?? ["full_time"]).map((v) => ({ value: v, label: label(v) }))}
            error={e("job.employmentType")}
          />
          <SelectInput
            label="Work schedule"
            value={f.workScheduleId}
            onChange={set("workScheduleId")}
            placeholder="Organisation default"
            options={(schedules.data?.items ?? [])
              .filter((s) => !s.archived)
              .map((s) => ({ value: s.id, label: `${s.name}${s.isDefault ? " (default)" : ""}` }))}
            error={e("job.workScheduleId")}
          />
          <DateInput
            label="Probation ends"
            value={f.probationEnd}
            onChange={set("probationEnd")}
            error={e("job.probationEnd")}
          />
        </FormSection>

        <FormSection title="Pay" description="Payroll admins only. Leave empty and a payroll admin can add it later.">
          <SelectInput
            label="Pay basis"
            value={f.payBasis}
            onChange={set("payBasis")}
            options={["monthly", "hourly"].map((v) => ({ value: v, label: label(v) }))}
            error={e("compensation.payBasis")}
          />
          <FormField
            label={f.payBasis === "hourly" ? "Hourly rate" : "Basic monthly pay"}
            error={
              e("compensation.amountCents") ??
              (errorDetails<{ area?: string }>(save.error)?.area === "compensation"
                ? errorMessage(save.error)
                : undefined)
            }
          >
            <MoneyInput value={amount} onChange={(c) => setAmount(c)} />
          </FormField>
        </FormSection>

        {foreigner ? (
          <FormSection title="Work pass" description="Required: the pass must be valid on the start date.">
            <SelectInput
              label="Pass type"
              required
              value={f.passType}
              onChange={set("passType")}
              options={(ref.data?.workPassTypes ?? []).map((p) => ({ value: p.code, label: p.label }))}
              error={e("workPass.passType") ?? e("workPass")}
            />
            <TextInput
              label="Pass / FIN number"
              mono
              value={f.passNumber}
              onChange={set("passNumber")}
              error={e("workPass.passNumber")}
              autoComplete="off"
            />
            <DateInput
              label="Issued on"
              value={f.passIssuedOn}
              onChange={set("passIssuedOn")}
              error={e("workPass.issuedOn")}
            />
            <DateInput
              label="Expires on"
              required
              value={f.passExpiresOn}
              onChange={set("passExpiresOn")}
              error={e("workPass.expiresOn")}
            />
          </FormSection>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            <UserPlus aria-hidden /> {save.isPending ? "Saving…" : "Add employee"}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/people">Cancel</Link>
          </Button>
        </div>
      </form>
      <LinkDialog
        link={invite ? { title: "Send them this sign-in link", body: invite.body, url: invite.url } : null}
        onOpenChange={(open) => {
          if (open || !invite) return;
          const { employeeId } = invite;
          setInvite(null);
          void navigate({ to: "/people/$employeeId", params: { employeeId } });
        }}
      />
    </>
  );
}

/** The hire response's `invite` (see POST /api/v1/employees). */
interface HireInvite {
  status: "emailed" | "link" | "linked" | "skipped";
  inviteUrl: string | null;
  message: string;
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 rounded-lg border border-border bg-surface-50 p-4 sm:grid-cols-2 sm:p-5">
      <legend className="-ml-1 px-1 font-azeret text-2xs font-semibold uppercase tracking-wider">{title}</legend>
      {description ? <p className="-mt-2 text-ui text-primary-300 sm:col-span-2">{description}</p> : null}
      {children}
    </fieldset>
  );
}
