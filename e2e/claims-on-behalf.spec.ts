import { deflateSync } from "node:zlib";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * close-claims-gaps: an HR admin without an employee record files a claim for Nadia from the claim
 * form (employee picker; Nadia's types, caps and receipt ownership), and the exchange rate, far
 * from the last THB rate used in the company, is flagged on the claim page and in the approver's
 * Inbox. Employees get no picker. Both claims are withdrawn at the end so other specs see the
 * Inbox as seeded.
 */
const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 360, height: 780 };

async function signedIn(browser: Browser, email: string, viewport = DESKTOP): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    ...(viewport === NARROW ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

/** A small, valid grey PNG (the server checks the signature; the viewer can show it). */
function png(): Buffer {
  const w = 16;
  const h = 16;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h, 200);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

test("HR files a claim for an employee; the rate far from the last one used is flagged for the approver", async ({
  browser,
}) => {
  // Nadia's own THB claim sets the last THB rate used in the company: 0.038000.
  const nadia = await signedIn(browser, E2E.members.leaveStaff.email);
  const types = (await (await nadia.request.get("/api/v1/claims/eligible-types")).json()) as {
    items: { id: string; code: string }[];
  };
  const transport = types.items.find((t) => t.code === "TRANSPORT")?.id as string;
  const ref = await nadia.request.post("/api/v1/claims", {
    data: {
      submit: true,
      lines: [
        {
          claimTypeId: transport,
          expenseDate: today(),
          merchant: "BTS Skytrain",
          description: "Train to the supplier, Bangkok",
          currency: "THB",
          amountMinor: 30_000,
          rate: "0.038000",
          receiptIds: [],
        },
      ],
    },
  });
  expect(ref.status(), await ref.text()).toBe(201);
  const refClaim = (await ref.json()) as { id: string; lines: { fxWarning: unknown }[] };
  expect(refClaim.lines[0]?.fxWarning).toBeNull();

  // Nadia (an employee) gets no employee picker.
  await nadia.goto("/claims");
  await nadia.getByTestId("new-claim").click();
  const own = nadia.getByTestId("claim-sheet");
  await expect(own.getByRole("radio", { name: "Transport" })).toBeVisible();
  await expect(own.getByRole("combobox", { name: "Claim for" })).toHaveCount(0);
  await nadia.keyboard.press("Escape");

  // Tan Mei Ling (HR admin, no employee record of her own) files for Nadia.
  const hr = await signedIn(browser, E2E.members.hr.email);
  await hr.goto("/claims");
  await expect(hr.getByText("You can file a claim for an employee")).toBeVisible();
  await hr.getByTestId("new-claim").click();
  const sheet = hr.getByTestId("claim-sheet");
  await expect(sheet.getByTestId("choose-employee-first")).toBeVisible();
  await sheet.getByTestId("submit-claim").click();
  await expect(sheet.getByText("Choose who this claim is for.")).toBeVisible();
  const picker = sheet.getByRole("combobox", { name: "Claim for" });
  await picker.click();
  await hr.getByPlaceholder("Name or employee number").fill("nadia");
  await hr.getByRole("option", { name: /Nadia Rahman/ }).click();
  await expect(picker).toContainText("Nadia Rahman");
  await expect(sheet.getByText("Choose who this claim is for.")).toHaveCount(0);

  const line = sheet.getByTestId("claim-line-0");
  await expect(line.getByRole("radio", { name: "Transport" })).toBeVisible();
  await line.getByTestId("receipt-file-0").setInputFiles({ name: "grab-bkk.png", mimeType: "image/png", buffer: png() });
  await expect(line.getByRole("button", { name: /View receipt grab-bkk/ })).toBeVisible();
  await line.getByLabel("Currency").click();
  await hr.getByRole("option", { name: /THB/ }).click();
  await line.getByLabel("Amount").fill("700.00");
  await line.getByLabel(/Rate: SGD per 1 THB/).fill("0.050000");
  await expect(line.getByTestId("sgd-preview")).toHaveText("= S$35.00");
  await line.getByRole("radio", { name: "Transport" }).click();
  await line.getByLabel("Merchant").fill("Grab");
  await line.getByLabel("Description").fill("Taxi from Suvarnabhumi Airport to the supplier");
  await sheet.getByTestId("submit-claim").click();
  await expect(hr.getByText(/Claim C-\d{4,} for Nadia Rahman sent for approval/)).toBeVisible();

  // The claim page (where HR lands) is Nadia's, with the rate flagged.
  await expect(hr).toHaveURL(/\/claims\/[0-9a-f-]{36}$/);
  const claimId = hr.url().split("/claims/")[1] as string;
  await expect(hr.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(hr.getByText(E2E.members.leaveStaff.name).first()).toBeVisible();
  const warning = hr.getByTestId("fx-warning");
  await expect(warning).toContainText(
    "THB 0.050000 is 31.58% above the last THB rate used in your organisation, 0.038000",
  );
  await expect(hr.getByTestId("fx-warning-line")).toHaveText("31.58% above last rate 0.038000");
  // Nadia's claim, with a receipt that is hers.
  const asNadia = (await (await nadia.request.get(`/api/v1/claims/${claimId}`)).json()) as {
    approvalRequestId: string;
    employee: { name: string };
    lines: { receipts: { name: string }[]; fxWarning: { deviationBasisPoints: number } | null }[];
  };
  expect(asNadia.employee.name).toBe(E2E.members.leaveStaff.name);
  expect(asNadia.lines[0]?.receipts.map((r) => r.name)).toEqual(["grab-bkk.png"]);
  expect(asNadia.lines[0]?.fxWarning?.deviationBasisPoints).toBe(3158);

  // Kai Wen, Nadia's manager, sees the check in the Inbox.
  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  const tasks = (await (await kaiWen.request.get("/api/v1/approvals/tasks")).json()) as {
    items: { taskId: string; requestId: string }[];
  };
  const taskId = tasks.items.find((t) => t.requestId === asNadia.approvalRequestId)?.taskId;
  expect(taskId).toBeDefined();
  await kaiWen.goto(`/inbox?task=${taskId}`);
  const panel = kaiWen.getByTestId("request-panel");
  await expect(panel).toContainText("Exchange rate");
  await expect(panel).toContainText("THB 0.050000 is 31.58% above the last THB rate used, 0.038000 on");

  // Kai Wen is an HR admin with his own record: "Me" by default, someone else on request.
  await kaiWen.goto("/claims");
  await kaiWen.getByTestId("new-claim").click();
  await expect(kaiWen.getByTestId("claim-sheet").getByRole("combobox", { name: "Claim for" })).toHaveText(/^Me/);
  await kaiWen.keyboard.press("Escape");

  // At 360 px wide the picker and the form fit without sideways scrolling.
  const narrow = await signedIn(browser, E2E.members.hr.email, NARROW);
  await narrow.goto("/claims/admin");
  await narrow.getByTestId("new-claim").click();
  const small = narrow.getByTestId("claim-sheet");
  await small.getByRole("combobox", { name: "Claim for" }).click();
  await narrow.getByPlaceholder("Name or employee number").fill("wei ming");
  await narrow.getByRole("option", { name: /Tan Wei Ming/ }).click();
  await expect(small.getByTestId("claim-line-0").getByRole("radio", { name: "Transport" })).toBeVisible();
  expect(await narrow.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROW.width);
  await narrow.keyboard.press("Escape");

  // Leave the Inbox as seeded: HR withdraws the claim it submitted, Nadia hers.
  expect((await hr.request.post(`/api/v1/claims/${claimId}/withdraw`)).status()).toBe(200);
  expect((await nadia.request.post(`/api/v1/claims/${refClaim.id}/withdraw`)).status()).toBe(200);
  for (const p of [nadia, hr, kaiWen, narrow]) await p.context().close();
});
