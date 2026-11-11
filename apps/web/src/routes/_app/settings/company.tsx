import { Alert, AlertDescription, AlertTitle, Button, StatusPill, toast } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Building2 } from "lucide-react";
import * as React from "react";
import { canForAll, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { api, companyQuery, errorMessage, fieldErrors, invalidatePeople } from "../people/-lib/api.ts";
import { ErrorPanel, PanelSkeleton, TextInput } from "../people/-lib/ui.tsx";

export const Route = createFileRoute("/_app/settings/company")({ component: CompanyPage });

const empty = {
  legalName: "",
  tradingName: "",
  uen: "",
  csn: "",
  addressBlock: "",
  addressStreet: "",
  addressUnit: "",
  addressBuilding: "",
  postalCode: "",
};

function CompanyPage() {
  // Everyone may read the company profile; only owners and HR admins change it.
  const editable = canForAll(useMe(), "org_structure:update");
  const qc = useQueryClient();
  const q = useQuery(companyQuery);
  const [f, setF] = React.useState(empty);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (!q.data || loaded) return;
    const p = q.data.profile;
    if (p) {
      setF({
        legalName: p.legalName,
        tradingName: p.tradingName ?? "",
        uen: p.uen,
        csn: p.csn ?? "",
        addressBlock: p.address.block ?? "",
        addressStreet: p.address.street ?? "",
        addressUnit: p.address.unit ?? "",
        addressBuilding: p.address.building ?? "",
        postalCode: p.address.postalCode ?? "",
      });
    }
    setLoaded(true);
  }, [q.data, loaded]);
  const set = (k: keyof typeof empty) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: () => api("PUT", "/organisation/profile", f),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast("Company profile saved");
    },
  });
  const errs = fieldErrors(save.error);
  const profile = q.data?.profile;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Company"
        description="The legal entity on payslips, CPF submissions and IR8A. One UEN and one CSN per organisation."
        actions={
          profile ? (
            profile.payrollReady ? (
              <StatusPill tone="success">Ready for payroll</StatusPill>
            ) : (
              <StatusPill tone="warning">
                Payroll blocked: add {profile.missingForPayroll.join(", ").toUpperCase()}
              </StatusPill>
            )
          ) : null
        }
      />
      {q.isPending ? (
        <PanelSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <form
          noValidate
          className="flex max-w-3xl flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!profile ? (
            <Alert variant="info">
              <Building2 aria-hidden />
              <div>
                <AlertTitle>Set up your company</AlertTitle>
                <AlertDescription>
                  Legal name and UEN are enough to start. Payroll needs the CSN and address too.
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          {save.isError && !Object.keys(errs).length ? (
            <Alert variant="danger">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>Not saved</AlertTitle>
                <AlertDescription>{errorMessage(save.error)}</AlertDescription>
              </div>
            </Alert>
          ) : null}
          <fieldset
            disabled={!editable}
            className="grid gap-4 rounded-lg border border-border bg-surface-50 p-4 sm:grid-cols-2 sm:p-5"
          >
            <legend className="-ml-1 px-1 font-azeret text-2xs font-semibold uppercase tracking-wider">
              Legal entity
            </legend>
            <TextInput
              label="Legal name"
              required
              value={f.legalName}
              onChange={set("legalName")}
              error={errs.legalName}
              hint="As registered with ACRA."
              className="sm:col-span-2"
            />
            <TextInput
              label="Trading name"
              value={f.tradingName}
              onChange={set("tradingName")}
              error={errs.tradingName}
            />
            <TextInput
              label="UEN"
              required
              mono
              value={f.uen}
              onChange={set("uen")}
              error={errs.uen}
              placeholder="201912345K"
            />
            <TextInput
              label="CPF Submission Number (CSN)"
              mono
              value={f.csn}
              onChange={set("csn")}
              error={errs.csn}
              placeholder={`${f.uen || "201912345K"}PTE01`}
              hint="Your UEN + payment type (PTE for staff) + 2-digit serial."
              className="sm:col-span-2"
            />
          </fieldset>
          <fieldset
            disabled={!editable}
            className="grid gap-4 rounded-lg border border-border bg-surface-50 p-4 sm:grid-cols-2 sm:p-5"
          >
            <legend className="-ml-1 px-1 font-azeret text-2xs font-semibold uppercase tracking-wider">
              Registered address
            </legend>
            <TextInput
              label="Block / house no."
              value={f.addressBlock}
              onChange={set("addressBlock")}
              error={errs.addressBlock}
            />
            <TextInput
              label="Street"
              value={f.addressStreet}
              onChange={set("addressStreet")}
              error={errs.addressStreet}
            />
            <TextInput
              label="Unit"
              mono
              value={f.addressUnit}
              onChange={set("addressUnit")}
              error={errs.addressUnit}
              placeholder="#12-04"
            />
            <TextInput
              label="Building"
              value={f.addressBuilding}
              onChange={set("addressBuilding")}
              error={errs.addressBuilding}
            />
            <TextInput
              label="Postal code"
              mono
              inputMode="numeric"
              value={f.postalCode}
              onChange={set("postalCode")}
              error={errs.postalCode}
              placeholder="079903"
            />
          </fieldset>
          <p className="text-2xs text-primary-200">Time zone Asia/Singapore · currency SGD (fixed).</p>
          {editable ? (
            <div>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save company profile"}
              </Button>
            </div>
          ) : (
            <p className="text-ui text-primary-300">Only owners and HR admins can change the company profile.</p>
          )}
        </form>
      )}
    </>
  );
}
