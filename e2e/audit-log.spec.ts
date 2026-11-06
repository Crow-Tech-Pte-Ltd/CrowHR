import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { E2E, MOCK_IDP, uiSignInOk } from "./fixtures.ts";

/**
 * add-identity-and-access task 9.3: Settings → Audit log filters and exports to CSV, and an
 * hr_admin never sees single sign-on or security-settings events (on screen, in the API or in the
 * export). The owner makes the SSO events first: adds a (disabled) provider and removes it.
 */
test.describe.configure({ mode: "serial" });

/** RFC 4180 rows (quoted cells may hold commas, doubled quotes and line breaks). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** The action column of an audit CSV export. */
const actionsOf = (csv: string) =>
  parseCsv(csv)
    .slice(1)
    .map((r) => r[4] ?? "");

/** Today in Singapore as YYYY-MM-DD (correct when the test machine runs in UTC too). */
const sgToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

async function filter(page: Page, f: { action?: string; from?: string; to?: string }) {
  const form = page.getByRole("form", { name: "Filter audit log" });
  await form.getByLabel("Action or prefix").fill(f.action ?? "");
  await form.getByLabel("From").fill(f.from ?? "");
  await form.getByLabel("To").fill(f.to ?? "");
  await form.getByRole("button", { name: "Apply filters" }).click();
}

test("owner filters by action and date, opens an entry and exports CSV", async ({ page }) => {
  await uiSignInOk(page, E2E.members.owner.email);
  // SSO events: a provider added (discovery checked against the mock IdP) and removed again.
  const created = await page.request.post("/api/v1/security/providers", {
    data: {
      kind: "oidc",
      displayName: "Audit Keycloak",
      issuer: MOCK_IDP.issuer,
      clientId: MOCK_IDP.clientId,
      clientSecret: MOCK_IDP.clientSecret,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await page.request.delete(`/api/v1/security/providers/${id}`)).status()).toBe(204);

  await page.goto("/settings/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(page.getByText("You see every event.")).toBeVisible();

  // A bad date says how to fix it, and nothing is applied.
  await filter(page, { action: "sso.", from: "1 Nov 2026" });
  await expect(page.getByText("Use YYYY-MM-DD, like 2026-10-01.")).toBeVisible();

  const today = sgToday();
  await filter(page, { action: "sso.", from: today, to: today });
  const table = page.getByTestId("audit-table");
  await expect(table.getByRole("row").filter({ hasText: "Sign-in method added" }).first()).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Sign-in method removed" }).first()).toBeVisible();
  await expect(table).not.toContainText("Signed in");

  // A label typed into the filter is sent as its key.
  await filter(page, { action: "Sign-in method added", from: today, to: today });
  await expect(table.getByRole("row").filter({ hasText: "Sign-in method added" }).first()).toBeVisible();
  await expect(table).not.toContainText("Sign-in method removed");
  await table.getByRole("row").filter({ hasText: "Sign-in method added" }).last().click();
  await expect(table).toContainText('"action": "sso.provider_created"');
  await expect(table).toContainText('"issuer"');

  // Nothing matches a day with no events.
  await filter(page, { action: "sso.", from: "2020-01-01", to: "2020-01-02" });
  await expect(page.getByText("No events match")).toBeVisible();

  // Export uses the same filters.
  await filter(page, { action: "sso.", from: today, to: today });
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^crowhr-audit-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await download.path()) as string, "utf8");
  expect(csv.split("\r\n")[0]).toBe("seq,at,actor_type,actor,action,target_type,target_id,ip,request_id,diff,meta");
  const actions = actionsOf(csv);
  expect(actions.length).toBeGreaterThanOrEqual(2);
  expect(
    actions.every((a) => a.startsWith("sso.")),
    actions.join(" "),
  ).toBe(true);
  expect(actions).toContain("sso.provider_created");
  expect(actions).toContain("sso.provider_deleted");
});

test("an hr_admin cannot see single sign-on events, on screen, in the API or in the export", async ({ page }) => {
  await uiSignInOk(page, E2E.members.hr.email);
  await page.goto("/settings/audit");
  await expect(
    page.getByText("You see everything except security-settings, single sign-on and payroll events."),
  ).toBeVisible();
  // HR does see other events, such as sign-ins.
  await filter(page, { action: "auth.signed_in" });
  await expect(page.getByTestId("audit-table")).toContainText("Signed in");

  await filter(page, { action: "sso." });
  await expect(page.getByText("No events match")).toBeVisible();
  const api = await page.request.get("/api/v1/audit-events?action=sso.");
  expect(api.status()).toBe(200);
  expect(((await api.json()) as { items: unknown[] }).items).toEqual([]);
  const settings = await page.request.get("/api/v1/audit-events?action=security_settings.");
  expect(((await settings.json()) as { items: unknown[] }).items).toEqual([]);

  const all = await page.request.get("/api/v1/audit-events/export.csv");
  expect(all.status()).toBe(200);
  const actions = actionsOf(await all.text());
  expect(actions).toContain("auth.signed_in");
  expect(actions.filter((a) => a.startsWith("sso.") || a.startsWith("security_settings."))).toEqual([]);
});
