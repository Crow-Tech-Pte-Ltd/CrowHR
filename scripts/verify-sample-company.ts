/**
 * Checks a Crow HR server's sample company (scripts/seed-sample-company.ts) the way the mobile
 * apps use it: discovery (`/api/v1/meta`), the native sign-in (PKCE, browser sign-in page API,
 * token exchange) and the employee and manager screens over the bearer API. Prints a summary
 * without any secret; exits non-zero when something a store reviewer needs is missing.
 *
 *   node scripts/verify-sample-company.ts --credentials <file from the seed script> [--exercise]
 *   SERVER=… ORG=kopi-kaki EMPLOYEE_EMAIL=… EMPLOYEE_PASSWORD=… MANAGER_EMAIL=… MANAGER_PASSWORD=… \
 *     node scripts/verify-sample-company.ts [--exercise]
 *
 * Read-only by default (apart from the sign-ins, which the apps' device lists show and which are
 * signed out at the end). --exercise also does what a reviewer does: the employee applies for
 * one day of leave about six weeks ahead, clocks in and out, and the manager approves that leave.
 * The pending requests the seed left for the manager are not touched.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { credentials: { type: "string" }, exercise: { type: "boolean", default: false } },
});

interface Account {
  email: string;
  password: string;
  reviewer?: string | null;
}
let server = process.env.SERVER ?? "";
let org = process.env.ORG ?? "kopi-kaki";
let employee: Account = { email: process.env.EMPLOYEE_EMAIL ?? "", password: process.env.EMPLOYEE_PASSWORD ?? "" };
let manager: Account = { email: process.env.MANAGER_EMAIL ?? "", password: process.env.MANAGER_PASSWORD ?? "" };
if (values.credentials) {
  const file = JSON.parse(readFileSync(values.credentials, "utf8")) as {
    server: string;
    org: string;
    accounts: Account[];
  };
  server = file.server;
  org = file.org;
  const pick = (role: string) => {
    const a = file.accounts.find((x) => x.reviewer === role);
    if (!a) throw new Error(`No ${role} account in ${values.credentials}`);
    return a;
  };
  employee = pick("employee");
  manager = pick("manager");
}
server = server.replace(/\/+$/, "");
if (!server || !employee.email || !employee.password || !manager.email || !manager.password) {
  process.stderr.write("Set --credentials, or SERVER, EMPLOYEE_EMAIL/PASSWORD and MANAGER_EMAIL/PASSWORD.\n");
  process.exit(64);
}

const results: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ check: name, ok, detail });
  process.stderr.write(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}\n`);
};
const b64url = (b: Buffer) => b.toString("base64url");
const sgToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00Z`).getUTCDay() + 6) % 7));

async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The apps' sign-in: authorize (PKCE) → the sign-in page's API call → token exchange. */
async function nativeSignIn(account: Account, client: "ios" | "android") {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const redirectUri = "crowtech.crowhr:/oauth2redirect";
  const authorize = await fetch(
    `${server}/api/v1/native/authorize?${new URLSearchParams({
      org,
      client,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    })}`,
    { redirect: "manual" },
  );
  const location = authorize.headers.get("location") ?? "";
  const nativeRequestId = new URL(location, server).searchParams.get("native");
  if (authorize.status !== 302 || !nativeRequestId) throw new Error(`authorize: HTTP ${authorize.status} ${location}`);
  const signIn = await json<{ mfaRequired: boolean; redirectTo?: string }>(
    await fetch(`${server}/api/v1/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server },
      body: JSON.stringify({ org, email: account.email, password: account.password, nativeRequestId }),
    }),
    `sign-in ${account.email}`,
  );
  if (signIn.mfaRequired) throw new Error(`${account.email} must enter a two-step verification code`);
  const back = new URL(signIn.redirectTo ?? "");
  if (back.searchParams.get("state") !== state) throw new Error("state mismatch");
  const tokens = await json<{ accessToken: string }>(
    await fetch(`${server}/api/v1/native/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        code: back.searchParams.get("code"),
        codeVerifier: verifier,
        deviceName: "Store review server check",
        appVersion: "verify-sample-company",
      }),
    }),
    "token exchange",
  );
  const auth = { authorization: `Bearer ${tokens.accessToken}` };
  return {
    get: async <T>(path: string) => json<T>(await fetch(`${server}${path}`, { headers: auth }), `GET ${path}`),
    /** GET, or POST when a body is given; the response is not checked. */
    raw: (path: string, body?: unknown) =>
      body === undefined
        ? fetch(`${server}${path}`, { headers: auth })
        : fetch(`${server}${path}`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    post: async <T>(path: string, body: unknown = {}) =>
      json<T>(
        await fetch(`${server}${path}`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        `POST ${path}`,
      ),
    revoke: () => fetch(`${server}/api/v1/native/revoke`, { method: "POST", headers: auth }),
  };
}

interface Shift {
  date: string;
  kind: string;
  start: string | null;
}

async function main() {
  const today = sgToday();
  const anyOrg = await json<{ orgSlugRequired: boolean }>(await fetch(`${server}/api/v1/meta`), "meta");
  check("discovery without an organisation", true, `orgSlugRequired=${anyOrg.orgSlugRequired}`);
  const meta = await json<{ organisations: { slug: string; displayName: string; signInMethods?: unknown }[] }>(
    await fetch(`${server}/api/v1/meta?org=${encodeURIComponent(org)}`),
    "meta?org",
  );
  const found = meta.organisations.find((o) => o.slug === org);
  const methods = JSON.stringify(found?.signInMethods ?? meta);
  check("discovery of the organisation", !!found, found ? found.displayName : "not found");
  check("no single sign-on buttons", !/google|entra|singpass|oidc/i.test(methods), methods.slice(0, 200));

  const emp = await nativeSignIn(employee, "ios");
  const mgr = await nativeSignIn(manager, "android");
  try {
    const me = await emp.get<{ user?: { displayName?: string }; roles?: string[] }>("/api/v1/me");
    check("employee signs in to the app (no two-step verification)", true, me.user?.displayName ?? "signed in");
    const payslips = await emp.get<{ items: { id: string; periodLabel?: string; month?: string }[] }>(
      "/api/v1/payslips",
    );
    check("employee payslips", payslips.items.length > 0, `${payslips.items.length} released`);
    if (payslips.items[0]) {
      const pdf = await emp.raw(`/api/v1/payslips/${payslips.items[0].id}/pdf`);
      const head = Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString();
      check("payslip PDF", pdf.ok && head === "%PDF-", `HTTP ${pdf.status}, ${head}`);
    }
    const balances = await emp.get<{ items: { code: string; available: number | null }[] }>("/api/v1/leave/balances");
    const annual = balances.items.find((b) => b.code === "annual");
    check("leave balances", balances.items.length > 0, `annual available ${annual?.available ?? "?"} days`);
    const types = await emp.get<{ items: unknown[] }>("/api/v1/claims/eligible-types");
    check("claim types", types.items.length > 0, `${types.items.length} types`);
    const claims = await emp.get<{ items: { id: string }[] }>("/api/v1/claims?mine=true");
    check("employee claims", claims.items.length > 0, `${claims.items.length} claims`);
    // A receipt the seed uploaded: the file must be in the server's storage, not just the database.
    let receipt: string | null = null;
    for (const c of claims.items) {
      const detail = await emp.get<{ lines: { receipts?: { id: string }[] }[] }>(`/api/v1/claims/${c.id}`);
      receipt = detail.lines.flatMap((l) => l.receipts ?? [])[0]?.id ?? null;
      if (receipt) break;
    }
    if (receipt) {
      const file = await emp.raw(`/api/v1/claims/receipts/${receipt}`);
      check("claim receipt file", file.ok, `HTTP ${file.status} ${file.headers.get("content-type")}`);
    } else {
      check("claim receipt file", false, "no claim with a receipt");
    }
    const week = await emp.get<{ shifts: Shift[] }>(
      `/api/v1/scheduling/me?from=${mondayOf(today)}&to=${addDays(mondayOf(today), 6)}`,
    );
    const worked = week.shifts.filter((s) => s.kind === "shift");
    check("schedule this week", worked.length > 0, `${worked.length} shifts (week of ${mondayOf(today)})`);
    const ahead = await emp.get<{ shifts: Shift[] }>(`/api/v1/scheduling/me?from=${today}&to=${addDays(today, 55)}`);
    const weeks = new Set(ahead.shifts.filter((s) => s.kind === "shift").map((s) => mondayOf(s.date)));
    check("roster for the next 8 weeks", weeks.size >= 8, `${weeks.size} weeks with shifts`);

    const tasks = await mgr.get<{ items: { taskId: string; subjectType: string; requester: { name: string } }[] }>(
      "/api/v1/approvals/tasks",
    );
    check(
      "manager has requests to approve",
      tasks.items.length > 0,
      tasks.items.map((t) => `${t.subjectType} from ${t.requester.name}`).join("; "),
    );

    if (values.exercise) {
      const leaveTypes = await emp.get<{ items: { id: string; code: string }[] }>("/api/v1/leave/types");
      const annualType = leaveTypes.items.find((t) => t.code === "annual");
      if (!annualType) throw new Error("No annual leave type");
      // A rostered day about six weeks ahead without leave on it already.
      let request: { id: string } | null = null;
      let applied = "";
      for (const s of ahead.shifts.filter((x) => x.kind === "shift" && x.date >= addDays(today, 40))) {
        const res = await emp.raw("/api/v1/leave/requests", {
          leaveTypeId: annualType.id,
          startDate: s.date,
          endDate: s.date,
          reason: "Store review server check",
        });
        if (res.status === 409) continue;
        request = await json<{ id: string }>(res, "apply for leave");
        applied = s.date;
        break;
      }
      if (!request) throw new Error("No free rostered day six weeks ahead to apply for leave");
      check("employee applies for leave", true, applied);
      const at = new Date().toISOString();
      const key = `verify-${Date.now()}`;
      for (const kind of ["in", "out"] as const) {
        await emp.post("/api/v1/attendance/punches", {
          kind,
          idempotencyKey: `${key}-${kind}`,
          deviceTime: at,
          sentAt: at,
          queued: false,
          source: "ios",
          location: null,
        });
      }
      check("employee clocks in and out", true, "no location or network restriction");
      // Decide only the requests this check filed; the seeded ones stay for the reviewer.
      const approveOwn = async (field: "approvalRequestId" | "cancellationRequestId") => {
        const leave = await emp.get<Record<typeof field, string | null>>(`/api/v1/leave/requests/${request.id}`);
        const inbox = await mgr.get<{ items: { taskId: string; requestId: string }[] }>("/api/v1/approvals/tasks");
        const task = inbox.items.find((t) => t.requestId === leave[field]);
        if (!task) return null;
        await mgr.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, {
          decision: "approve",
          comment: "Approved.",
        });
        return (await emp.get<{ status: string }>(`/api/v1/leave/requests/${request.id}`)).status;
      };
      const approved = await approveOwn("approvalRequestId");
      check("manager approves the leave", approved === "approved", approved ?? "the request was not in the inbox");
      // Give the day back, so repeated checks don't use up the reviewer's leave balance.
      await emp.post(`/api/v1/leave/requests/${request.id}/cancel`, { reason: "Check finished." });
      const cancelled = await approveOwn("cancellationRequestId");
      check("leave cancelled again", cancelled === "cancelled", cancelled ?? "the cancellation was not in the inbox");
    }
  } finally {
    await emp.revoke().catch(() => undefined);
    await mgr.revoke().catch(() => undefined);
  }
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `${JSON.stringify({ server, org, passed: results.length - failed.length, failed: failed.length })}\n`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(`FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
