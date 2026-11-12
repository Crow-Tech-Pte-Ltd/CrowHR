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
  FormField,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Switch,
  textStyle,
} from "@crowhr/ui";
import { Info } from "lucide-react";
import * as React from "react";
import { useReauth } from "../auth/reauth.tsx";
import { PROVIDER_LABEL, type Provider, type ProviderKind } from "../auth/types.ts";
import { CopyField } from "../components/copy-field.tsx";
import { ApiError, apiPatch, apiPost } from "../lib/api.ts";

/** Where to find each value at the identity provider. Shown next to the form. */
const GUIDE: Record<ProviderKind, { steps: string[]; link?: { href: string; label: string } }> = {
  google: {
    steps: [
      "In Google Cloud Console, open APIs & Services → Credentials and create an OAuth client ID of type Web application.",
      "Save here first, then add the redirect URI shown after saving to Authorised redirect URIs.",
      "Copy the client ID and client secret into this form.",
      "Add your Workspace domain below so only accounts from it can sign in.",
    ],
    link: {
      href: "https://developers.google.com/identity/openid-connect/openid-connect",
      label: "Google OpenID Connect guide",
    },
  },
  entra: {
    steps: [
      "In Microsoft Entra admin centre, open App registrations → New registration (single tenant).",
      "Copy the Directory (tenant) ID and Application (client) ID from the Overview page.",
      "Under Certificates & secrets, create a client secret and copy its Value (not the ID).",
      "Save here, then add the redirect URI shown after saving under Authentication → Web.",
    ],
    link: {
      href: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
      label: "Microsoft: register an app",
    },
  },
  singpass: {
    steps: [
      "Your company must first be onboarded as a Singpass relying party (Singpass Developer Portal). Crow HR can't do that for you.",
      "Save without a client ID first. Crow HR generates the signing and encryption keys and shows the redirect URI and JWKS URL to enter in the Singpass Developer Portal.",
      "When Singpass issues the client ID, edit this method and add it.",
      "Run a test sign-in on staging before switching to production.",
    ],
    link: { href: "https://docs.developer.singpass.gov.sg/", label: "Singpass developer documentation" },
  },
  oidc: {
    steps: [
      "In your identity provider (Okta, Keycloak, Authentik…), create an OpenID Connect web application using the authorization code flow.",
      "Enter its issuer URL: Crow HR reads <issuer>/.well-known/openid-configuration.",
      "Copy the client ID and secret. Save, then register the redirect URI shown after saving.",
    ],
  },
};

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function ProviderDialog({
  kind,
  existing,
  onOpenChange,
  onSaved,
}: {
  kind: ProviderKind | null;
  existing: Provider | null;
  onOpenChange: (o: boolean) => void;
  onSaved: (p: Provider) => void;
}) {
  const withReauth = useReauth();
  const k = existing?.kind ?? kind;
  const [form, setForm] = React.useState({
    displayName: "",
    issuer: "",
    clientId: "",
    clientSecret: "",
    tenantId: "",
    environment: "staging",
    domains: "",
    jit: false,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [failure, setFailure] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<Provider | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setErrors({});
    setFailure(null);
    setSaved(null);
    setForm({
      displayName: existing?.displayName ?? "",
      issuer: existing?.kind === "oidc" || existing?.kind === "singpass" ? existing.issuer : "",
      clientId: existing?.clientId ?? "",
      clientSecret: "",
      tenantId: existing?.tenantId ?? "",
      environment: existing?.environment ?? "staging",
      domains: existing?.allowedDomains.join(", ") ?? "",
      jit: existing?.jitEnabled ?? false,
    });
  }, [existing]);
  if (!k) return null;
  const guide = GUIDE[k];
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const domains = form.domains
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    if (!form.clientId.trim() && k !== "singpass") errs.clientId = "Paste the client ID from your identity provider.";
    if (k !== "singpass" && !existing && !form.clientSecret)
      errs.clientSecret = "Paste the client secret from your identity provider.";
    if (k === "entra" && !form.tenantId.trim())
      errs.tenantId = "Enter your tenant (directory) ID from the Entra Overview page.";
    if (k === "oidc" && !/^https?:\/\//.test(form.issuer.trim()))
      errs.issuer = "Enter the issuer URL, starting with https://.";
    const badDomain = domains.find((d) => !DOMAIN_RE.test(d));
    if (badDomain)
      errs.allowedDomains = `"${badDomain}" isn't a domain. Use the form kampongkopi.sg, separated by commas.`;
    if (form.jit && !domains.length)
      errs.allowedDomains = "Add at least one allowed domain to create accounts automatically.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body: Record<string, unknown> = {
      ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
      ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
      ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
      ...(k === "entra" ? { tenantId: form.tenantId.trim() } : {}),
      ...(k === "oidc" ? { issuer: form.issuer.trim() } : {}),
      ...(k === "singpass"
        ? { environment: form.environment, ...(form.issuer.trim() ? { issuer: form.issuer.trim() } : {}) }
        : {}),
      ...(k !== "singpass" ? { allowedDomains: domains, jitEnabled: form.jit } : {}),
    };
    setBusy(true);
    setFailure(null);
    try {
      const p = await withReauth(() =>
        existing
          ? apiPatch<Provider>(`/api/v1/security/providers/${existing.id}`, body)
          : apiPost<Provider>("/api/v1/security/providers", { kind: k, ...body }),
      );
      setSaved(p);
      onSaved(p);
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else if (!(err instanceof ApiError && err.code === "reauth_required"))
        setFailure(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!k} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.displayName}` : `Connect ${PROVIDER_LABEL[k]}`}</DialogTitle>
          <DialogDescription>Saved disabled. Turn it on after a successful test sign-in.</DialogDescription>
        </DialogHeader>
        {saved ? (
          <div className="flex flex-col gap-4" data-testid="provider-saved">
            <Alert variant="success">
              <Info aria-hidden />
              <div>
                <AlertTitle>Saved. Now register Crow HR at the provider</AlertTitle>
                <AlertDescription>
                  Copy these values into your identity provider, then use "Test sign-in" on the Security page.
                </AlertDescription>
              </div>
            </Alert>
            <FormField label="Redirect URI (callback)">
              <CopyField value={saved.callbackUrl} label="redirect URI" />
            </FormField>
            {saved.jwksUrl ? (
              <FormField label="JWKS URL (public keys for Singpass)">
                <CopyField value={saved.jwksUrl} label="JWKS URL" />
              </FormField>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_15rem]">
            <form id="provider-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
              {failure ? (
                <p role="alert" className="text-ui text-danger-300">
                  {failure}
                </p>
              ) : null}
              {k === "oidc" ? (
                <>
                  <FormField label="Button label" hint='Shown as "Sign in with …", e.g. Okta.'>
                    <Input
                      value={form.displayName}
                      onChange={(e) => set({ displayName: e.target.value })}
                      placeholder="Okta"
                    />
                  </FormField>
                  <FormField label="Issuer URL" error={errors.issuer}>
                    <Input
                      value={form.issuer}
                      onChange={(e) => set({ issuer: e.target.value })}
                      placeholder="https://login.example.com/realms/acme"
                    />
                  </FormField>
                </>
              ) : null}
              {k === "entra" ? (
                <FormField
                  label="Tenant (directory) ID"
                  error={errors.tenantId}
                  hint="A GUID. Multi-tenant values like common or organizations are not allowed."
                >
                  <Input value={form.tenantId} onChange={(e) => set({ tenantId: e.target.value })} className="num" />
                </FormField>
              ) : null}
              {k === "singpass" ? (
                <>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-ui font-medium">Environment</legend>
                    <RadioGroup
                      value={form.environment}
                      onValueChange={(v) => set({ environment: v })}
                      className="flex gap-4"
                    >
                      {(["staging", "production"] as const).map((env) => (
                        <div key={env} className="flex items-center gap-2">
                          <RadioGroupItem id={`env-${env}`} value={env} />
                          <Label htmlFor={`env-${env}`} className="font-sans font-normal">
                            {env === "staging" ? "Staging" : "Production"}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </fieldset>
                  <FormField
                    label="Issuer override (optional)"
                    hint="Leave empty to use the Singpass default for the environment."
                  >
                    <Input value={form.issuer} onChange={(e) => set({ issuer: e.target.value })} />
                  </FormField>
                </>
              ) : null}
              <FormField
                label={k === "singpass" ? "Client ID (optional until Singpass issues it)" : "Client ID"}
                error={errors.clientId}
                hint={
                  k === "singpass"
                    ? "Singpass issues it after you register the redirect URI and JWKS URL shown when you save."
                    : undefined
                }
              >
                <Input
                  value={form.clientId}
                  onChange={(e) => set({ clientId: e.target.value })}
                  className="num"
                  autoComplete="off"
                />
              </FormField>
              {k !== "singpass" ? (
                <FormField
                  label="Client secret"
                  error={errors.clientSecret}
                  hint={
                    existing?.clientSecretSet
                      ? "A secret is saved. Leave empty to keep it."
                      : "Stored encrypted; never shown again."
                  }
                >
                  <Input
                    type="password"
                    value={form.clientSecret}
                    onChange={(e) => set({ clientSecret: e.target.value })}
                    autoComplete="off"
                  />
                </FormField>
              ) : null}
              {k !== "singpass" ? (
                <>
                  <FormField
                    label={k === "google" ? "Allowed Workspace domains" : "Allowed email domains"}
                    error={errors.allowedDomains}
                    hint={
                      k === "google"
                        ? "Only accounts from these domains can sign in (checked against Google's hd claim)."
                        : "Used to limit automatic account creation."
                    }
                  >
                    <Input
                      value={form.domains}
                      onChange={(e) => set({ domains: e.target.value })}
                      placeholder="kampongkopi.sg"
                    />
                  </FormField>
                  <div className="flex items-start gap-3">
                    <Switch id="jit" checked={form.jit} onCheckedChange={(c) => set({ jit: c })} />
                    <Label htmlFor="jit" className="flex flex-col gap-0.5 font-sans font-normal">
                      <span className="font-medium">Create accounts on first sign-in</span>
                      <span className="text-2xs text-primary-300">
                        Off by default. When on, anyone with a verified email in the allowed domains gets a member
                        account with no role.
                      </span>
                    </Label>
                  </div>
                </>
              ) : null}
            </form>
            <aside className="rounded-md bg-surface-100 p-3 text-2xs leading-5 text-primary-300">
              <p className={cn("mb-2", textStyle.group)}>Where to find these</p>
              <ol className="list-decimal space-y-1.5 pl-4">
                {guide.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {guide.link ? (
                <a
                  href={guide.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-biru-400 underline"
                >
                  {guide.link.label}
                </a>
              ) : null}
            </aside>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {saved ? "Done" : "Cancel"}
          </Button>
          {saved ? null : (
            <Button variant="primary" type="submit" form="provider-form" disabled={busy}>
              {busy ? "Checking the provider…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
