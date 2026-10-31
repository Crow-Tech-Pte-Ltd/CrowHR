import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
} from "@crowhr/ui";
import { CheckCircle2 } from "lucide-react";
import * as React from "react";
import type { AssignedRole, Member } from "../auth/types.ts";
import { ROLE_LABEL } from "../auth/types.ts";
import { CopyField } from "../components/copy-field.tsx";
import { ApiError, apiPost } from "../lib/api.ts";

const ROLE_HELP: Record<AssignedRole, string> = {
  owner: "Everything, including security settings, sign-in methods and who holds roles.",
  hr_admin: "People records, leave and claims, invitations. Not salaries or bank details.",
  payroll_admin: "Pay, bank details, payroll runs, payslips and CPF. Combine with HR admin for a one-person HR team.",
};

export function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: AssignedRole[];
  onChange: (v: AssignedRole[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-300">
        Roles (optional, combinable)
      </legend>
      {(["owner", "hr_admin", "payroll_admin"] as const).map((r) => (
        <div key={r} className="flex items-start gap-2">
          <Checkbox
            id={`role-${r}`}
            checked={value.includes(r)}
            onCheckedChange={(c) => onChange(c ? [...value, r] : value.filter((x) => x !== r))}
          />
          <Label htmlFor={`role-${r}`} className="flex flex-col gap-0.5 font-sans text-ui font-normal">
            <span className="font-medium">{ROLE_LABEL[r]}</span>
            <span className="text-2xs text-primary-300">{ROLE_HELP[r]}</span>
          </Label>
        </div>
      ))}
      <p className="text-2xs text-primary-200">
        Everyone linked to an employee record is an employee; managers are worked out from reporting lines.
      </p>
    </fieldset>
  );
}

export function InviteDialog({
  open,
  onOpenChange,
  canGrantRoles,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canGrantRoles: boolean;
  onInvited: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [roles, setRoles] = React.useState<AssignedRole[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [failure, setFailure] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ inviteUrl: string | null; email: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRoles([]);
      setErrors({});
      setFailure(null);
      setResult(null);
    }
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "Enter their work email address, like name@company.sg.";
    if (!name.trim()) errs.displayName = "Enter the person's name as they'd like it shown.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiPost<{ inviteUrl: string | null }>("/api/v1/members/invitations", {
        email: email.trim(),
        displayName: name.trim(),
        roles,
      });
      setResult({ inviteUrl: res.inviteUrl, email: email.trim() });
      onInvited();
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else setFailure(err instanceof ApiError ? err.message : "Couldn't send the invitation.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They get a link to set a password or use your organisation's single sign-on. Links last 7 days.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-3" data-testid="invite-result">
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertDescription>
                {result.inviteUrl
                  ? `Email isn't set up on this server, so send ${result.email} this link yourself (chat or email). It's shown once.`
                  : `Invitation emailed to ${result.email}.`}
              </AlertDescription>
            </Alert>
            {result.inviteUrl ? (
              <CopyField value={result.inviteUrl} label="invitation link" testId="invite-link" />
            ) : null}
          </div>
        ) : (
          <form id="invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
            {failure ? (
              <p role="alert" className="text-ui text-danger-300">
                {failure}
              </p>
            ) : null}
            <FormField label="Work email" error={errors.email}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </FormField>
            <FormField label="Name" error={errors.displayName}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            {canGrantRoles ? (
              <RolePicker value={roles} onChange={setRoles} />
            ) : (
              <p className="text-2xs text-primary-300">
                Only an owner can invite someone with a role. They'll join as a member.
              </p>
            )}
          </form>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
          {result ? null : (
            <Button variant="primary" type="submit" form="invite-form" disabled={busy}>
              {busy ? "Inviting…" : "Send invitation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RolesDialog({
  member,
  onOpenChange,
  onSave,
}: {
  member: Member | null;
  onOpenChange: (o: boolean) => void;
  onSave: (roles: AssignedRole[]) => Promise<void>;
}) {
  const [roles, setRoles] = React.useState<AssignedRole[]>([]);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setRoles(member?.roles ?? []);
    setFailure(null);
  }, [member]);
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Roles for {member?.displayName}</DialogTitle>
          <DialogDescription>
            Changes apply on their next click. Every change is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <p role="alert" className="text-ui text-danger-300">
            {failure}
          </p>
        ) : null}
        <RolePicker value={roles} onChange={setRoles} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              try {
                await onSave(roles);
                onOpenChange(false);
              } catch (err) {
                if (!(err instanceof ApiError && err.code === "reauth_required"))
                  setFailure(err instanceof Error ? err.message : "Couldn't save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save roles"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinkDialog({
  link,
  onOpenChange,
}: {
  link: { title: string; body: string; url: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!link} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{link?.title}</DialogTitle>
          <DialogDescription>{link?.body}</DialogDescription>
        </DialogHeader>
        {link ? <CopyField value={link.url} label="link" testId="one-time-link" /> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
