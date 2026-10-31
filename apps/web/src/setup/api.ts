import type { ErrorEnvelope } from "@crowhr/core";

/** Header the one-time setup code travels in (core `SETUP_CODE_HEADER`). */
export const SETUP_CODE_HEADER = "x-setup-code";

export type SetupState = { kind: "required" } | { kind: "done" } | { kind: "error"; message: string };

export interface SetupError {
  status: number;
  code: string;
  message: string;
  /** Field → fix-it message, from `validation_failed` details. */
  fields: Record<string, string>;
}

async function parseError(res: Response): Promise<SetupError> {
  const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
  const details = body?.error.details as { issues?: { path: string; message: string }[] } | undefined;
  const fields: Record<string, string> = {};
  for (const issue of details?.issues ?? []) fields[issue.path] ??= issue.message;
  return {
    status: res.status,
    code: body?.error.code ?? "internal",
    message: body?.error.message ?? `The server answered ${res.status}. Check that Crow HR is running.`,
    fields,
  };
}

export async function fetchSetupState(): Promise<SetupState> {
  try {
    const res = await fetch("/api/v1/setup", { headers: { accept: "application/json" } });
    if (res.ok) return { kind: "required" };
    if (res.status === 404) return { kind: "done" };
    return { kind: "error", message: (await parseError(res)).message };
  } catch {
    return { kind: "error", message: "Cannot reach the Crow HR server. Check that the app container is running." };
  }
}

export async function verifySetupCode(code: string): Promise<SetupError | null> {
  const res = await fetch("/api/v1/setup/verify", {
    method: "POST",
    headers: { accept: "application/json", [SETUP_CODE_HEADER]: code },
  });
  return res.ok ? null : parseError(res);
}

export interface SetupInput {
  organisationName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

export async function completeSetup(
  code: string,
  input: SetupInput,
): Promise<{ ok: true; organisationSlug: string } | { ok: false; error: SetupError }> {
  const res = await fetch("/api/v1/setup", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", [SETUP_CODE_HEADER]: code },
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: await parseError(res) };
  const body = (await res.json()) as { organisationSlug: string };
  return { ok: true, organisationSlug: body.organisationSlug };
}
