import { expect, type Page, test } from "@playwright/test";

/** WS6b design-review screenshots at 1440 and 390 wide. Only runs when WS6B_SHOTS_DIR is set. */
const DIR = process.env.WS6B_SHOTS_DIR;
test.skip(!DIR, "set WS6B_SHOTS_DIR to capture screenshots");

async function as(page: Page, persona: string, to: string) {
  await page.goto(`/__dev/as/${persona}?to=${encodeURIComponent(to)}`);
}

async function snap(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

async function both(page: Page, name: string, prepare: () => Promise<void>, fullPage = true) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await prepare();
    await snap(page, `${name}-${w}`, fullPage);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("WS6b reports and documents screens", async ({ page }) => {
  test.setTimeout(240_000);
  const employees = (await (await page.request.get("/__dev/employees")).json()) as Record<string, string>;
  const newhire = employees.newhire as string;
  const barista = employees.barista1 as string;

  // Seed: a KET for the new hire (acknowledgement requested) and an expiring pass copy.
  await as(page, "payroll", "/reports");
  const templates = (await (await page.request.get("/api/v1/documents/templates")).json()) as {
    items: { id: string; kind: string }[];
  };
  const ket = templates.items.find((t) => t.kind === "ket")?.id as string;
  const terms = {
    "terms.main_duties": "Prepare coffee and serve customers at the outlet.",
    "terms.fixed_deductions": "None",
    "terms.overtime_period": "Monthly, paid with the salary",
    "terms.overtime_rate": "1.5 times the hourly basic rate",
    "terms.other_salary": "Annual performance bonus at the company's discretion",
    "terms.medical_benefits": "Outpatient GP visits up to S$300 a year",
    "employment.notice_period": "1 week during probation, 1 month after",
    "signatory.title": "HR Manager",
  };
  const dry = (await (
    await page.request.post("/api/v1/documents/generate", {
      data: { templateId: ket, employeeId: newhire, overrides: terms, dryRun: true },
    })
  ).json()) as { missing: { id: string }[] };
  const overrides = {
    ...terms,
    ...Object.fromEntries(dry.missing.map((m) => [m.id, "As agreed in the offer letter"])),
  };
  const gen = await page.request.post("/api/v1/documents/generate", {
    data: { templateId: ket, employeeId: newhire, overrides, requestAcknowledgement: true },
  });
  expect(gen.status()).toBe(200);
  const cats = (await (await page.request.get("/api/v1/documents/categories")).json()) as {
    items: { id: string; systemKey: string }[];
  };
  const identity = cats.items.find((c) => c.systemKey === "identity")?.id as string;
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");
  const up = await page.request.post(
    `/api/v1/documents/upload?employeeId=${barista}&categoryId=${identity}&title=NRIC%20copy%20(front)&expiresOn=${soon}&fileName=nric.pdf`,
    { data: pdf, headers: { "content-type": "application/octet-stream" } },
  );
  expect(up.status()).toBe(201);

  await both(page, "reports-catalogue", async () => {
    await page.goto("/reports");
    await expect(page.getByTestId("report-payroll.cost")).toBeVisible();
  });
  await both(page, "report-headcount", async () => {
    await page.goto("/reports/people.headcount?by=department&columns=basicPay");
    await expect(page.getByTestId("report-totals")).toBeVisible();
  });
  await both(page, "report-turnover", async () => {
    await page.goto("/reports/people.turnover");
    await expect(page.getByTestId("report-summary")).toBeVisible();
  });
  await both(page, "report-payroll-cost", async () => {
    await page.goto("/reports/payroll.cost?from=2026-01&to=2026-12");
    await expect(page.getByTestId("report-totals")).toBeVisible();
  });
  await both(page, "report-empty", async () => {
    await page.goto("/reports/claims.summary?from=2026-01-01&to=2026-01-31");
    await expect(page.getByTestId("report-empty")).toBeVisible();
  });
  await both(page, "profile-documents", async () => {
    await page.goto(`/people/${newhire}?tab=documents`);
    await expect(page.getByTestId("document-row").first()).toBeVisible();
  });
  await both(
    page,
    "generate-dialog",
    async () => {
      await page.goto(`/people/${newhire}?tab=documents`);
      await page.getByTestId("open-generate").click();
      await expect(page.getByTestId("letter-preview")).toContainText("Lee Mei Xin");
    },
    false,
  );
  await both(page, "documents-expiring", async () => {
    await page.goto("/documents?tab=expiring");
    await expect(page.getByTestId("document-row").first()).toBeVisible();
  });
  await both(page, "settings-documents", async () => {
    await page.goto("/settings/documents");
    await expect(page.getByRole("table", { name: "Document categories" })).toBeVisible();
  });
  await both(page, "template-editor", async () => {
    await page.goto("/settings/documents");
    await page
      .getByRole("row", { name: /Key Employment Terms/ })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.getByTestId("template-editor").getByTestId("letter-preview")).toBeVisible();
    await page.getByTestId("template-editor").scrollIntoViewIfNeeded();
  });

  // The new hire's view.
  await as(page, "newhire", "/");
  await both(page, "home-acknowledge", async () => {
    await page.goto("/");
    await expect(page.getByText(/Read and acknowledge/)).toBeVisible();
  });
  await both(page, "my-documents", async () => {
    await page.goto("/documents");
    await expect(page.getByTestId("to-acknowledge")).toBeVisible();
  });
  await both(
    page,
    "document-sheet",
    async () => {
      await page.goto("/documents");
      await page.getByTestId("to-acknowledge").getByRole("button").first().click();
      await expect(page.getByTestId("acknowledge")).toBeVisible();
    },
    false,
  );

  // A manager's team-scoped catalogue.
  await as(page, "manager", "/reports");
  await both(page, "reports-manager", async () => {
    await page.goto("/reports");
    await expect(page.getByTestId("report-leave.taken")).toBeVisible();
  });
});
