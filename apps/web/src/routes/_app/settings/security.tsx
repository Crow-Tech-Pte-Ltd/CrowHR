import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  Input,
  Label,
  Skeleton,
  StatusPill,
  Switch,
  toast,
} from "@crowhr/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, KeyRound, Lock, Plus, ShieldCheck } from "lucide-react";
import * as React from "react";
import { formatDateTime } from "../../../auth/format.ts";
import { useReauth } from "../../../auth/reauth.tsx";
import { useMe } from "../../../auth/session.ts";
import {
  type AssignedRole,
  PROVIDER_LABEL,
  type Provider,
  type ProviderKind,
  ROLE_LABEL,
  type SecuritySettings,
} from "../../../auth/types.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote, Section } from "../../../components/section.tsx";
import { ApiError, apiDelete, apiGet, apiPatch } from "../../../lib/api.ts";
import { ProviderDialog } from "../../../settings/provider-setup.tsx";

export const Route = createFileRoute("/_app/settings/security")({
  validateSearch: (s: Record<string, unknown>): { test?: string; provider?: string; reason?: string } => ({
    ...(typeof s.test === "string" ? { test: s.test } : {}),
    ...(typeof s.provider === "string" ? { provider: s.provider } : {}),
    ...(typeof s.reason === "string" ? { reason: s.reason } : {}),
  }),
  component: SecurityPage,
});

const settingsKey = ["security", "settings"] as const;

function SecurityPage() {
  const me = useMe();
  const search = Route.useSearch();
  const q = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiGet<SecuritySettings>("/api/v1/security/settings"),
    enabled: me.roles.includes("owner"),
  });
  if (!me.roles.includes("owner")) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Settings", to: "/settings" }]} title="Security" />
        <EmptyState
          icon={<Lock />}
          title="Only owners can change security settings"
          description="Sign-in methods, two-step verification policy and session timeouts are managed by your organisation's owners."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Security"
        description="How people sign in, who must use two-step verification, and how long sessions last. Every change is recorded in the audit log."
      />
      {search.test ? (
        <TestResult
          ok={search.test === "ok"}
          reason={search.reason}
          providers={q.data?.providers ?? []}
          providerId={search.provider}
        />
      ) : null}
      {q.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="Loading security settings">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          {q.data.insecureTransport ? (
            <Alert variant="warning" className="mb-6" data-testid="insecure-transport">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>Not using HTTPS</AlertTitle>
                <AlertDescription>
                  PUBLIC_URL starts with http://, so session cookies aren't protected in transit. That's acceptable on a
                  trusted office network only. Put Crow HR behind HTTPS (see the reverse-proxy guide) before using it
                  over the internet.
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          {q.data.demoMode ? (
            <Alert variant="info" className="mb-6">
              <AlertDescription>
                Not available in the demo. Self-hosted installs can enable single sign-on here.
              </AlertDescription>
            </Alert>
          ) : null}
          <SignInMethods settings={q.data} />
          <MfaPolicy settings={q.data} />
          <Timeouts settings={q.data} />
        </>
      )}
    </>
  );
}

function TestResult({
  ok,
  reason,
  providers,
  providerId,
}: {
  ok: boolean;
  reason?: string;
  providers: Provider[];
  providerId?: string;
}) {
  const name = providers.find((p) => p.id === providerId)?.displayName ?? "the provider";
  return ok ? (
    <Alert variant="success" className="mb-6" data-testid="test-result">
      <CheckCircle2 aria-hidden />
      <div>
        <AlertTitle>Test sign-in with {name} worked</AlertTitle>
        <AlertDescription>
          You can now turn it on for everyone, and, once staff can sign in with it, turn off passwords.
        </AlertDescription>
      </div>
    </Alert>
  ) : (
    <Alert variant="danger" className="mb-6" data-testid="test-result">
      <AlertTriangle aria-hidden />
      <div>
        <AlertTitle>Test sign-in with {name} failed</AlertTitle>
        <AlertDescription>
          Reason: <span className="font-azeret">{reason ?? "unknown"}</span>. Check the client ID and secret, that the
          redirect URI is registered exactly, and for Google/Entra the allowed domain or tenant. Details are in the
          audit log.
        </AlertDescription>
      </div>
    </Alert>
  );
}

function providerStatus(p: Provider): { tone: "neutral" | "success" | "warning" | "info"; label: string } {
  if (!p.configured) return { tone: "warning", label: "Not configured" };
  if (!p.enabled) return { tone: "neutral", label: p.lastTestOkAt ? "Off · tested" : "Off · not tested" };
  return { tone: "success", label: p.lastTestOkAt ? "On" : "On · not tested" };
}

function SignInMethods({ settings }: { settings: SecuritySettings }) {
  const qc = useQueryClient();
  const withReauth = useReauth();
  const [adding, setAdding] = React.useState<ProviderKind | null>(null);
  const [editing, setEditing] = React.useState<Provider | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: settingsKey });
  const tested = settings.providers.some((p) => p.enabled && p.lastTestOkAt);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await withReauth(fn);
      toast.success(ok);
      refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "reauth_required"))
        toast.error(err instanceof Error ? err.message : "Couldn't save.");
    }
  };
  const missingKinds = (["google", "entra", "singpass", "oidc"] as const).filter(
    (k) => k === "oidc" || !settings.providers.some((p) => p.kind === k),
  );

  return (
    <Section
      id="methods"
      title="Sign-in methods"
      description="Only methods that are on and fully configured appear on the sign-in page."
      actions={
        settings.demoMode ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary">
                <Plus />
                Add a method
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {missingKinds.map((k) => (
                <DropdownMenuItem key={k} onSelect={() => setAdding(k)}>
                  {PROVIDER_LABEL[k]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <ul className="divide-y divide-border" data-testid="sign-in-methods">
        <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-3">
            <KeyRound className="mt-0.5 size-4" aria-hidden />
            <span>
              <span className="block font-azeret text-xs font-semibold">Email and password</span>
              <span className="block text-ui text-primary-300">
                {settings.passwordEnabled
                  ? "Everyone can sign in with a password (plus two-step verification where required)."
                  : "Off for staff. Owners can still sign in with a password as a break-glass route."}
                {!settings.passwordEnabled || tested
                  ? null
                  : " To turn it off, first turn on a single sign-on method and complete a test sign-in."}
              </span>
            </span>
          </span>
          <Switch
            aria-label="Email and password sign-in"
            checked={settings.passwordEnabled}
            disabled={settings.passwordEnabled && !tested}
            onCheckedChange={(c) =>
              void run(
                () => apiPatch("/api/v1/security/settings", { passwordEnabled: c }),
                c ? "Password sign-in is on." : "Password sign-in is off for staff.",
              )
            }
          />
        </li>
        {settings.providers.length === 0 ? (
          <li className="p-4 text-ui text-primary-300">
            No single sign-on yet. Add Google Workspace, Microsoft Entra ID, Singpass or any OpenID Connect provider.
          </li>
        ) : null}
        {settings.providers.map((p) => {
          const status = providerStatus(p);
          return (
            <li
              key={p.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`provider-${p.kind}`}
            >
              <span className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4" aria-hidden />
                <span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-azeret text-xs font-semibold">{p.displayName}</span>
                    <span className="text-2xs text-primary-200">{PROVIDER_LABEL[p.kind]}</span>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </span>
                  <span className="block text-2xs text-primary-300">
                    {p.kind === "singpass" && !p.configured ? (
                      <>
                        Waiting for the client ID from Singpass. In the Singpass Developer Portal, enter the redirect
                        URI <span className="num break-all">{p.callbackUrl}</span> and the JWKS URL{" "}
                        <span className="num break-all">{p.jwksUrl}</span>, then edit this method to add the client ID
                        Singpass issues.{" "}
                        <a
                          className="text-biru-400 underline"
                          href="https://docs.developer.singpass.gov.sg/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Setup guide
                        </a>
                      </>
                    ) : (
                      <>
                        {p.allowedDomains.length ? `Domains: ${p.allowedDomains.join(", ")} · ` : ""}
                        {p.kind === "entra" && p.tenantId ? `Tenant ${p.tenantId.slice(0, 8)}… · ` : ""}
                        {p.lastTestOkAt ? `Last test ${formatDateTime(p.lastTestOkAt)}` : "Not tested yet"}
                        {p.jitEnabled ? " · Creates accounts on first sign-in" : ""}
                      </>
                    )}
                  </span>
                  {p.kind === "singpass" ? (
                    <span className="block text-2xs text-warning-400">
                      Tested against a simulated Singpass only. Complete a staging test before production.
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!p.configured || settings.demoMode}
                  onClick={() => window.location.assign(`/api/v1/auth/oidc/${p.id}/start?purpose=test`)}
                >
                  Test sign-in
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() => apiDelete(`/api/v1/security/providers/${p.id}`), `${p.displayName} removed.`)
                  }
                >
                  Remove
                </Button>
                <Switch
                  aria-label={`${p.displayName} sign-in`}
                  checked={p.enabled}
                  disabled={!p.configured || settings.demoMode}
                  onCheckedChange={(c) =>
                    void run(
                      () => apiPatch(`/api/v1/security/providers/${p.id}`, { enabled: c }),
                      c ? `${p.displayName} is on.` : `${p.displayName} is off.`,
                    )
                  }
                />
              </span>
            </li>
          );
        })}
      </ul>
      <ProviderDialog
        key={`${adding ?? ""}-${editing?.id ?? ""}`}
        kind={adding}
        existing={editing}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(null);
            setEditing(null);
          }
        }}
        onSaved={refresh}
      />
    </Section>
  );
}

function MfaPolicy({ settings }: { settings: SecuritySettings }) {
  const qc = useQueryClient();
  const withReauth = useReauth();
  const [roles, setRoles] = React.useState<AssignedRole[]>(settings.mfaRequiredRoles);
  const [busy, setBusy] = React.useState(false);
  const dirty = [...roles].sort().join() !== [...settings.mfaRequiredRoles].sort().join();
  return (
    <Section
      id="mfa-policy"
      title="Two-step verification policy"
      description="Members holding these roles must use an authenticator app with password sign-in. They get 7 days from the role grant to set it up. Single sign-on is exempt: your identity provider handles it there."
    >
      <div className="flex flex-col gap-3 p-4">
        {(["owner", "hr_admin", "payroll_admin"] as const).map((r) => (
          <div key={r} className="flex items-center gap-2">
            <Checkbox
              id={`mfa-${r}`}
              checked={roles.includes(r)}
              onCheckedChange={(c) => setRoles(c ? [...roles, r] : roles.filter((x) => x !== r))}
            />
            <Label htmlFor={`mfa-${r}`} className="font-sans font-normal">
              {ROLE_LABEL[r]}
            </Label>
          </div>
        ))}
        {!roles.includes("owner") ? (
          <p className="text-2xs text-warning-400">
            Owners can change every setting. Requiring two-step verification for them is strongly recommended.
          </p>
        ) : null}
        <div>
          <Button
            size="sm"
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await withReauth(() => apiPatch("/api/v1/security/settings", { mfaRequiredRoles: roles }));
                toast.success("Two-step verification policy saved.");
                void qc.invalidateQueries({ queryKey: settingsKey });
              } catch (err) {
                if (!(err instanceof ApiError && err.code === "reauth_required"))
                  toast.error(err instanceof Error ? err.message : "Couldn't save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save policy
          </Button>
        </div>
      </div>
    </Section>
  );
}

function Timeouts({ settings }: { settings: SecuritySettings }) {
  const qc = useQueryClient();
  const withReauth = useReauth();
  const [form, setForm] = React.useState({
    idle: String(settings.idleTimeoutMin),
    absolute: String(settings.absoluteTimeoutH),
    device: String(settings.deviceIdleDays),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const idle = Number(form.idle);
    const absolute = Number(form.absolute);
    const device = Number(form.device);
    const errs: Record<string, string> = {};
    if (!Number.isInteger(idle) || idle < 15 || idle > 240)
      errs.idleTimeoutMin = "Use a whole number of minutes from 15 to 240.";
    if (!Number.isInteger(absolute) || absolute < 1 || absolute > 24)
      errs.absoluteTimeoutH = "Use a whole number of hours from 1 to 24.";
    if (!Number.isInteger(device) || device < 1 || device > 90)
      errs.deviceIdleDays = "Use a whole number of days from 1 to 90.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await withReauth(() =>
        apiPatch("/api/v1/security/settings", {
          idleTimeoutMin: idle,
          absoluteTimeoutH: absolute,
          deviceIdleDays: device,
        }),
      );
      toast.success("Session timeouts saved. They apply to sessions from now on.");
      void qc.invalidateQueries({ queryKey: settingsKey });
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else if (!(err instanceof ApiError && err.code === "reauth_required"))
        toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="timeouts" title="Sessions" description="How long people stay signed in.">
      <form onSubmit={save} noValidate className="grid gap-4 p-4 sm:grid-cols-3">
        <FormField
          label="Sign out after inactivity (minutes)"
          error={errors.idleTimeoutMin}
          hint="15 to 240. Default 30."
        >
          <Input
            className="num"
            inputMode="numeric"
            value={form.idle}
            onChange={(e) => setForm({ ...form, idle: e.target.value })}
          />
        </FormField>
        <FormField label="Always sign out after (hours)" error={errors.absoluteTimeoutH} hint="1 to 24. Default 12.">
          <Input
            className="num"
            inputMode="numeric"
            value={form.absolute}
            onChange={(e) => setForm({ ...form, absolute: e.target.value })}
          />
        </FormField>
        <FormField
          label="Mobile app: sign out after unused (days)"
          error={errors.deviceIdleDays}
          hint="1 to 90. Default 30."
        >
          <Input
            className="num"
            inputMode="numeric"
            value={form.device}
            onChange={(e) => setForm({ ...form, device: e.target.value })}
          />
        </FormField>
        <div className="sm:col-span-3">
          <Button size="sm" type="submit" disabled={busy}>
            Save timeouts
          </Button>
        </div>
      </form>
    </Section>
  );
}
