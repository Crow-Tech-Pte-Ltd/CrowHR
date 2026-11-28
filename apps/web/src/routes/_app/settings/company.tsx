import { Alert, AlertDescription, AlertTitle, Button, cn, textStyle, toast } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Building2, ImageUp } from "lucide-react";
import * as React from "react";
import { AssistantSettingsPanel } from "../../../assistant/settings.tsx";
import { canForAll, useMe } from "../../../auth/session.ts";
import { AppearanceSettings } from "../../../branding/settings.tsx";
import { PageHeader } from "../../../components/page-header.tsx";
import { useLocale, useT } from "../../../i18n/index.ts";
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
  const t = useT("company");
  const locale = useLocale();
  // Everyone may read the company profile; only owners and HR admins change it.
  const me = useMe();
  const editable = canForAll(me, "org_structure:update");
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
      toast(t("Company profile saved"));
    },
  });
  const errs = fieldErrors(save.error);
  const profile = q.data?.profile;
  const missingFields =
    profile?.missingForPayroll.flatMap((field) => {
      if (field === "uen") return [t("UEN")];
      if (field === "csn") return [t("CPF Submission Number (CSN)")];
      if (field === "address") {
        return [
          ...(profile.address.street ? [] : [t("Street")]),
          ...(profile.address.postalCode ? [] : [t("Postal code")]),
        ];
      }
      return [field];
    }) ?? [];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("Settings"), to: "/settings" }]}
        title={t("Company")}
        description={t("The legal entity on payslips, CPF submissions and IR8A. One UEN and one CSN per organisation.")}
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
                <AlertTitle>{t("Set up your company")}</AlertTitle>
                <AlertDescription>
                  {t("Legal name and UEN are enough to start. Payroll needs the CSN and address too.")}
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          {missingFields.length ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>{t("Company details needed to finalise payroll")}</AlertTitle>
                <AlertDescription>
                  {t("Missing details: {fields}.", {
                    fields: new Intl.ListFormat(locale, { type: "conjunction" }).format(missingFields),
                  })}
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          {save.isError && !Object.keys(errs).length ? (
            <Alert variant="danger">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>{t("Not saved")}</AlertTitle>
                <AlertDescription>{errorMessage(save.error)}</AlertDescription>
              </div>
            </Alert>
          ) : null}
          <fieldset
            disabled={!editable}
            className="grid gap-4 rounded-lg border border-border bg-surface-50 p-4 sm:grid-cols-2 sm:p-5"
          >
            <legend className={cn("-ml-1 px-1", textStyle.group)}>{t("Legal entity")}</legend>
            <TextInput
              label={t("Legal name")}
              required
              value={f.legalName}
              onChange={set("legalName")}
              error={errs.legalName}
              hint={t("As registered with ACRA.")}
              className="sm:col-span-2"
            />
            <TextInput
              label={t("Trading name")}
              value={f.tradingName}
              onChange={set("tradingName")}
              error={errs.tradingName}
            />
            <TextInput
              label={t("UEN")}
              required
              mono
              value={f.uen}
              onChange={set("uen")}
              error={errs.uen}
              placeholder="201912345K"
            />
            <TextInput
              label={t("CPF Submission Number (CSN)")}
              mono
              value={f.csn}
              onChange={set("csn")}
              error={errs.csn}
              placeholder={`${f.uen || "201912345K"}PTE01`}
              hint={t("Your UEN + payment type (PTE for staff) + 2-digit serial.")}
              className="sm:col-span-2"
            />
          </fieldset>
          <fieldset
            disabled={!editable}
            className="grid gap-4 rounded-lg border border-border bg-surface-50 p-4 sm:grid-cols-2 sm:p-5"
          >
            <legend className={cn("-ml-1 px-1", textStyle.group)}>{t("Registered address")}</legend>
            <TextInput
              label={t("Block / house no.")}
              value={f.addressBlock}
              onChange={set("addressBlock")}
              error={errs.addressBlock}
            />
            <TextInput
              label={t("Street")}
              value={f.addressStreet}
              onChange={set("addressStreet")}
              error={errs.addressStreet}
            />
            <TextInput
              label={t("Unit")}
              mono
              value={f.addressUnit}
              onChange={set("addressUnit")}
              error={errs.addressUnit}
              placeholder="#12-04"
            />
            <TextInput
              label={t("Building")}
              value={f.addressBuilding}
              onChange={set("addressBuilding")}
              error={errs.addressBuilding}
            />
            <TextInput
              label={t("Postal code")}
              mono
              inputMode="numeric"
              value={f.postalCode}
              onChange={set("postalCode")}
              error={errs.postalCode}
              placeholder="079903"
            />
          </fieldset>
          {profile ? <LogoField hasLogo={profile.hasLogo} version={profile.updatedAt} editable={editable} /> : null}
          <p className="text-2xs text-primary-200">{t("Time zone Asia/Singapore · currency SGD (fixed).")}</p>
          {editable ? (
            <div>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? t("Saving…") : t("Save company profile")}
              </Button>
            </div>
          ) : (
            <p className="text-ui text-primary-300">{t("Only owners and HR admins can change the company profile.")}</p>
          )}
        </form>
      )}
      {me.roles.includes("owner") && !me.demoCompany ? (
        <AppearanceSettings
          {...(profile?.hasLogo
            ? { documentLogo: `/api/v1/organisation/profile/logo?v=${encodeURIComponent(profile.updatedAt)}` }
            : {})}
        />
      ) : null}
      {me.roles.includes("owner") ? (
        <div className="mt-8">
          <AssistantSettingsPanel company />
        </div>
      ) : null}
    </>
  );
}

const MAX_LOGO_BYTES = 1_000_000;

/** PNG bytes as base64, for the logo upload's JSON body. */
async function pngBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The PNG signature. The server checks the content too; this only saves a round trip. */
async function isPng(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
}

/**
 * Company logo for report PDFs and letters. It saves as soon as a PNG file is chosen.
 */
function LogoField({ hasLogo, version, editable }: { hasLogo: boolean; version: string; editable: boolean }) {
  const t = useT("company");
  const qc = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) =>
      api("PUT", "/organisation/profile/logo", { contentType: "image/png", dataBase64: await pngBase64(file) }),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast(t("Logo saved"));
    },
    onError: (err) => setProblem(errorMessage(err)),
  });
  const choose = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) return setProblem(t("The logo must be at most 1 MB. Export a smaller PNG."));
    if (!(await isPng(file)))
      return setProblem(t("Upload the logo as a PNG file. Export SVG or JPEG artwork to PNG first."));
    upload.mutate(file);
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface-50 p-4 sm:p-5">
      <legend className={cn("-ml-1 px-1", textStyle.group)}>{t("Logo")}</legend>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* The logo is printed on white letters: preview it on white in both themes. */}
        <div
          className={cn(
            "flex h-20 w-40 shrink-0 items-center justify-center rounded-md border border-border p-2",
            hasLogo ? "bg-white" : "bg-card",
          )}
        >
          {hasLogo ? (
            <img
              src={`/api/v1/organisation/profile/logo?v=${encodeURIComponent(version)}`}
              alt={t("Current company logo")}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-2xs text-primary-200">{t("No logo yet")}</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-ui text-primary-300">
            {t(
              "Printed on report PDFs and letters generated from templates. Use a PNG up to 1 MB. A transparent background works best.",
            )}
          </p>
          {editable ? (
            <div>
              <input
                ref={input}
                type="file"
                accept="image/png"
                aria-label={t("Logo file (PNG)")}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  void choose(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button type="button" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
                <ImageUp aria-hidden />{" "}
                {upload.isPending ? t("Uploading…") : hasLogo ? t("Replace logo") : t("Upload logo")}
              </Button>
            </div>
          ) : null}
          {problem ? (
            <p role="alert" className="text-2xs font-medium text-danger-300">
              {problem}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
