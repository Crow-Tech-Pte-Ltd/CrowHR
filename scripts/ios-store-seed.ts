/**
 * Store-screenshot seed for the iOS UI-test server (scripts/ios-ui-test.sh with
 * CROWHR_UI_STORE_SEED=1), run against the RUNNING server over its public API, like a second
 * phone: Wong Kai Wen publishes Nurul Huda's roster for the rest of this week and next week (weekdays,
 * 09:00-17:00 at her location), so Today shows her next shifts and a leave quote for tomorrow counts
 * a rostered day. Fictional e2e data only (e2e/fixtures.ts).
 *
 *   node scripts/ios-store-seed.ts http://127.0.0.1:3190
 */
import { createHash, randomBytes } from "node:crypto";
import { E2E } from "../e2e/fixtures.ts";

const base = process.argv[2] ?? "http://127.0.0.1:3190";
const org = E2E.org.slug;
const b64url = (b: Buffer) => b.toString("base64url");

// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON from the test server, read field by field.
async function call(method: string, path: string, token?: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  if (res.status === 302) return { location: res.headers.get("location") };
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** A bearer token through the same native sign-in the app uses (PKCE), as its own device session. */
async function token(email: string): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({
    org,
    client: "ios",
    redirect_uri: "crowtech.crowhr:/oauth2redirect",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: b64url(randomBytes(16)),
  });
  const { location } = await call("GET", `/api/v1/native/authorize?${q}`);
  const nativeRequestId = String(location).split("native=")[1]?.split("&")[0];
  if (!nativeRequestId) throw new Error(`authorize did not redirect to sign-in: ${location}`);
  const signedIn = await call("POST", "/api/v1/auth/sign-in", undefined, {
    org,
    email,
    password: E2E.password,
    nativeRequestId: decodeURIComponent(nativeRequestId),
  });
  const code = new URL(signedIn.redirectTo).searchParams.get("code");
  const tokens = await call("POST", "/api/v1/native/token", undefined, {
    grantType: "authorization_code",
    code,
    codeVerifier: verifier,
    deviceName: "Store screenshot seed",
  });
  return tokens.accessToken;
}

/** Singapore's today, as a UTC midnight date. */
function sgToday(): Date {
  const sg = new Date(Date.now() + 8 * 3_600_000);
  return new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate()));
}
const day = (d: Date, plus = 0) => new Date(d.getTime() + plus * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (d: Date) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);

const nurul = await token(E2E.members.crewA.email);
const kaiwen = await token(E2E.members.approver.email);
const { employeeId } = await call("GET", "/api/v1/me", nurul);
const scopes = await call("GET", "/api/v1/scheduling/scopes", kaiwen);
const locationId = scopes.mine?.locationId;
const today = sgToday();
const thisMonday = mondayOf(today);
for (const monday of [thisMonday, new Date(thisMonday.getTime() + 7 * 86_400_000)]) {
  // Weekdays after today only: a past day can't be rostered.
  const days = [0, 1, 2, 3, 4].map((i) => day(monday, i)).filter((d) => d > day(today));
  if (days.length === 0) continue;
  const mine = await call("GET", `/api/v1/scheduling/me?from=${days[0]}&to=${days.at(-1)}`, nurul);
  if ((mine.shifts ?? []).length > 0) {
    console.error(`store seed: Nurul already has shifts in the week of ${day(monday)}.`);
    continue;
  }
  const created = await call("POST", "/api/v1/scheduling/rosters", kaiwen, { weekStart: day(monday), locationId });
  const rosterId = (created.roster ?? created).id;
  for (const date of days) {
    await call("POST", `/api/v1/scheduling/rosters/${rosterId}/shifts`, kaiwen, {
      employeeId,
      date,
      kind: "shift",
      startTime: "09:00",
      endTime: "17:00",
      breakMinutes: 60,
    });
  }
  await call("POST", `/api/v1/scheduling/rosters/${rosterId}/publish`, kaiwen, {});
  console.error(`store seed: published Nurul's shifts ${days[0]} to ${days.at(-1)}.`);
}
