import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createCapturingMailer,
  createTestDb,
  createTestDeps,
  movableClock,
  type SeededMember,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { sha256Base64Url } from "../crypto/tokens.ts";
import { emailOutbox, notifications } from "../db/schema/notifications.ts";
import { tick } from "../jobs/tick.ts";
import { totpAt } from "./totp.ts";

/**
 * Security notices (add-identity-and-access, "Security notices in the in-app inbox and retryable
 * outbox delivery"): every security event a member should know about lands in their in-app
 * notifications, with or without SMTP, and is emailed through the retryable email outbox (never
 * sent inline, so an SMTP outage delays it instead of losing it). Sign-in setting changes go to
 * every owner.
 */

const PASSWORD = "chendol with gula melaka";
const MIN = 60_000;
const REDIRECT = "crowtech.crowhr:/oauth2redirect";
const VERIFIER = `${"v".repeat(20)}erifier-0123456789-abcdefghijklmnop`;

function world(withMailer: boolean) {
  const clock = movableClock("2026-11-02T01:00:00.000Z");
  const mailer = createCapturingMailer();
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  return {
    clock,
    mailer,
    async start() {
      t = await createTestDb();
      deps = createTestDeps(t.db, { clock, ...(withMailer ? { mailer } : {}) });
      app = createApp(deps);
      org = await seedOrg(deps, { slug: "kopi-kaki" });
    },
    close: () => t.close(),
    get deps() {
      return deps;
    },
    get app() {
      return app;
    },
    get org() {
      return org;
    },
    member: (email: string, roles: ("owner" | "hr_admin")[] = []) =>
      seedMember(deps, org.id, { email, password: PASSWORD, roles }),
    async notices(m: SeededMember) {
      return (
        await deps.db
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.recipientMembershipId, m.membershipId), eq(notifications.kind, "security_notice")),
          )
      ).map((n) => ({ title: n.title, body: n.body ?? "", link: n.link }));
    },
    async signIn(email: string, client = testClient(app, deps)) {
      const res = await client.post("/api/v1/auth/sign-in", { org: org.slug, email, password: PASSWORD });
      return { client, res, body: (await res.json()) as { mfaRequired: boolean; mfaToken?: string } };
    },
  };
}

describe("security notices without SMTP", () => {
  const w = world(false);
  beforeEach(() => w.start());
  afterEach(() => w.close());

  it("show in the in-app inbox through the notifications API, and nothing is queued for email", async () => {
    const m = await w.member("ravi@kopi.example");
    const me = await clientAs(w.app, w.deps, m);
    expect(
      (await me.post("/api/v1/me/password", { currentPassword: PASSWORD, newPassword: "kaya toast and kopi o" }))
        .status,
    ).toBe(204);
    const list = (await (await me.get("/api/v1/notifications")).json()) as {
      items: { kind: string; category: string; title: string; link: string }[];
    };
    expect(list.items).toContainEqual(
      expect.objectContaining({
        kind: "security_notice",
        category: "security",
        title: "Your Crow HR password was changed",
        link: "/me/sessions",
      }),
    );
    expect(await w.deps.db.select().from(emailOutbox)).toEqual([]);
  });

  it("two-step verification turned on, paused after wrong codes, recovery code used", async () => {
    const m = await w.member("siti@kopi.example");
    const me = await clientAs(w.app, w.deps, m);
    const setup = (await (await me.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    const confirm = await me.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(setup.secret, w.clock.now()) });
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
    w.clock.advance(31_000);
    expect((await w.notices(m)).map((n) => n.title)).toEqual(["Two-step verification was turned on"]);

    const step = await w.signIn("siti@kopi.example");
    for (let i = 0; i < 5; i++)
      await step.client.post("/api/v1/auth/mfa/verify", { mfaToken: step.body.mfaToken, code: String(200000 + i) });
    expect((await w.notices(m)).map((n) => n.title)).toContain("Two-step verification paused");

    w.clock.advance(16 * MIN);
    const again = await w.signIn("siti@kopi.example");
    const ok = await again.client.post("/api/v1/auth/mfa/verify", {
      mfaToken: again.body.mfaToken,
      code: recoveryCodes[0],
    });
    expect(ok.status).toBe(200);
    const used = (await w.notices(m)).find((n) => n.title === "A recovery code was used");
    expect(used?.body).toContain("You have 9 left");
  });

  it("an owner resetting a member's two-step verification tells the member", async () => {
    const m = await w.member("lee@kopi.example");
    const me = await clientAs(w.app, w.deps, m);
    const setup = (await (await me.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    await me.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(setup.secret, w.clock.now()) });
    const owner = await clientAs(w.app, w.deps, await w.member("owner@kopi.example", ["owner"]));
    expect((await owner.post(`/api/v1/members/${m.membershipId}/mfa/reset`)).status).toBe(204);
    expect((await w.notices(m)).map((n) => n.title)).toContain("Your two-step verification was reset");
  });

  it("a sign-in from a browser not used before is reported; the first sign-in and known browsers are not", async () => {
    const m = await w.member("farah@kopi.example");
    const first = await w.signIn("farah@kopi.example");
    expect(first.res.status).toBe(200);
    expect(await w.notices(m)).toEqual([]);
    // Same browser again: known device cookie.
    await w.signIn("farah@kopi.example", first.client);
    expect(await w.notices(m)).toEqual([]);
    // Another browser.
    await w.signIn("farah@kopi.example");
    const notes = await w.notices(m);
    expect(notes.map((n) => n.title)).toEqual(["New sign-in to your Crow HR account"]);
    expect(notes[0]?.body).toMatch(/password/);
    expect(notes[0]?.body).toContain("2 Nov 2026");
    expect(notes[0]?.body).toMatch(/Sign out everywhere/);
  });

  it("a new mobile device signing in is reported with its name", async () => {
    const m = await w.member("ahmad@kopi.example");
    const challenge = await sha256Base64Url(VERIFIER);
    const auth = await w.app.request(
      `/api/v1/native/authorize?org=${w.org.slug}&client=android&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=state-12345678`,
    );
    const nativeRequestId = (auth.headers.get("location") as string).split("native=")[1];
    const browser = testClient(w.app, w.deps);
    const signIn = await browser.post("/api/v1/auth/sign-in", {
      org: w.org.slug,
      email: "ahmad@kopi.example",
      password: PASSWORD,
      nativeRequestId,
    });
    const url = new URL(((await signIn.json()) as { redirectTo: string }).redirectTo);
    const token = await w.app.request("/api/v1/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        code: url.searchParams.get("code"),
        codeVerifier: VERIFIER,
        deviceName: "Pixel 9",
        appVersion: "1.0.0",
      }),
    });
    expect(token.status).toBe(200);
    const notes = await w.notices(m);
    expect(notes.map((n) => n.title)).toEqual(["A new device signed in to your account"]);
    expect(notes[0]?.body).toContain("Pixel 9");
  });

  it("sign-in setting changes go to every owner", async () => {
    const a = await w.member("owner-a@kopi.example", ["owner"]);
    const b = await w.member("owner-b@kopi.example", ["owner"]);
    const hr = await w.member("hr@kopi.example", ["hr_admin"]);
    const res = await (await clientAs(w.app, w.deps, a)).patch("/api/v1/security/settings", { idleTimeoutMin: 60 });
    expect(res.status).toBe(200);
    for (const owner of [a, b]) {
      const notes = await w.notices(owner);
      expect(notes.map((n) => n.title)).toEqual(["Sign-in settings were changed"]);
      expect(notes[0]?.link).toBe("/settings/security");
    }
    expect(await w.notices(hr)).toEqual([]);
  });
});

describe("security notice emails go through the retryable outbox", () => {
  const w = world(true);
  beforeEach(async () => {
    w.mailer.sent.length = 0;
    w.mailer.failing = false;
    await w.start();
  });
  afterEach(() => w.close());

  it("are queued, not sent inline; an SMTP failure is retried and the email is sent once it recovers", async () => {
    const m = await w.member("ravi@kopi.example");
    const me = await clientAs(w.app, w.deps, m);
    w.mailer.failing = true;
    expect(
      (await me.post("/api/v1/me/password", { currentPassword: PASSWORD, newPassword: "kaya toast and kopi o" }))
        .status,
    ).toBe(204);
    expect(w.mailer.sent).toEqual([]);
    const [queued] = await w.deps.db.select().from(emailOutbox);
    expect(queued).toMatchObject({ kind: "security_notice", status: "queued", toAddress: "ravi@kopi.example" });
    await tick(w.deps);
    expect((await w.deps.db.select().from(emailOutbox))[0]).toMatchObject({ status: "queued", attempts: 1 });
    w.mailer.failing = false;
    w.clock.advance(MIN);
    await tick(w.deps);
    expect(w.mailer.sent.map((e) => [e.to, e.subject])).toEqual([
      ["ravi@kopi.example", expect.stringMatching(/^Security notice/)],
    ]);
    expect(w.mailer.sent[0]?.text).toContain("Your Crow HR password was changed");
    expect((await w.deps.db.select().from(emailOutbox))[0]).toMatchObject({ status: "sent" });
  });

  it("are emailed even when the member turned other emails off", async () => {
    const m = await w.member("siti@kopi.example");
    const me = await clientAs(w.app, w.deps, m);
    await me.put("/api/v1/notifications/preferences", {
      email: { approvals: false, requests: false, reminders: false, updates: false },
    });
    await me.post("/api/v1/me/password", { currentPassword: PASSWORD, newPassword: "kaya toast and kopi o" });
    await tick(w.deps);
    expect(w.mailer.sent.map((e) => e.to)).toEqual(["siti@kopi.example"]);
  });
});
