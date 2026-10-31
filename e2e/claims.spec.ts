import { deflateSync } from "node:zlib";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * Claims end to end (add-claims): an employee snaps a receipt and submits a two-line claim on a
 * phone (cap remaining and the foreign-currency SGD preview update live) → their manager opens it
 * from the Inbox, views the receipt and approves → it is in the payroll reimbursement source for
 * the period (`GET /claims/payable`, the HTTP view of `ReimbursementSource.listPayable`).
 *
 * Screenshots (1440 and 390 wide) go to $CLAIMS_SHOTS_DIR when set.
 */
const SHOTS = process.env.CLAIMS_SHOTS_DIR;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ws6-${name}.png`, fullPage: true });
}

async function signedIn(browser: Browser, email: string, viewport = DESKTOP): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    ...(viewport === PHONE ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

/** A small PNG that looks like a till receipt (white paper, grey text lines), built without dependencies. */
function receiptPng(seed: number): Buffer {
  const w = 240;
  const h = 360;
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
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    const line = Math.floor(y / 18);
    const inText = y % 18 > 5 && y % 18 < 12 && y > 30 && y < h - 30;
    const lineLen = 60 + ((line * 37 + seed * 11) % 140);
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const dark = inText && x > 20 && x < 20 + lineLen;
      const v = dark ? 110 : 250 - ((x + y) % 3);
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = dark ? v : 245;
    }
  }
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

/** Last day of the current month in Asia/Singapore (the payroll period end for "this month"). */
function periodEnd(): string {
  const sg = new Date(Date.now() + 8 * 3_600_000);
  const last = new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

test("submit a claim with a receipt on a phone → manager approves in the Inbox → payable in the period", async ({
  browser,
}) => {
  // 1. The employee, on a phone.
  const ahmad = await signedIn(browser, E2E.members.requester.email, PHONE);
  await ahmad.goto("/claims");
  await expect(ahmad.getByRole("heading", { level: 1, name: "My claims" })).toBeVisible();
  await shot(ahmad, "my-claims-empty-390");
  await ahmad.getByTestId("new-claim").click();
  const sheet = ahmad.getByTestId("claim-sheet");
  await expect(sheet.getByRole("heading", { name: "New claim" })).toBeVisible();

  // Line 1: snap the receipt (camera input), phone bill against a S$50 monthly cap.
  const line1 = sheet.getByTestId("claim-line-0");
  await line1
    .getByTestId("receipt-camera-0")
    .setInputFiles({ name: "IMG_4021.png", mimeType: "image/png", buffer: receiptPng(1) });
  await expect(line1.getByRole("button", { name: /View receipt IMG_4021/ })).toBeVisible();
  await line1.getByLabel("Amount").fill("30.00");
  await line1.getByRole("radio", { name: "Mobile phone" }).click();
  await expect(line1.getByTestId("cap-remaining")).toHaveText(/S\$20\.00 left of S\$50\.00/);
  await line1.getByLabel("Merchant").fill("Singtel");
  await line1.getByLabel("Description").fill("Mobile bill, client calls");
  await line1.getByLabel("Amount").fill("35.50");
  await expect(line1.getByTestId("cap-remaining")).toHaveText(/S\$14\.50 left of S\$50\.00/);

  // Line 2: a meal in Johor Bahru, in ringgit, with the SGD preview.
  await sheet.getByRole("button", { name: "Add another expense" }).click();
  const line2 = sheet.getByTestId("claim-line-1");
  await line2
    .getByTestId("receipt-file-1")
    .setInputFiles({ name: "jb-dinner.png", mimeType: "image/png", buffer: receiptPng(2) });
  await expect(line2.getByRole("button", { name: /View receipt jb-dinner/ })).toBeVisible();
  await line2.getByLabel("Currency").click();
  await ahmad.getByRole("option", { name: /MYR/ }).click();
  await line2.getByLabel("Amount").fill("125.50");
  await line2.getByLabel(/Rate: SGD per 1 MYR/).fill("0.301234");
  await expect(line2.getByTestId("sgd-preview")).toHaveText("= S$37.80");
  await line2.getByRole("radio", { name: "Client entertainment" }).click();
  await line2.getByLabel("Merchant").fill("Restoran Hua Mui");
  await line2.getByLabel("Description").fill("Dinner with supplier, Johor Bahru");
  await expect(sheet.getByTestId("claim-total")).toHaveText("S$73.30");
  await shot(ahmad, "claim-sheet-390");
  await sheet.getByTestId("submit-claim").click();
  await expect(sheet).toHaveCount(0);
  const card = ahmad.getByTestId("my-claims-cards").getByRole("link").first();
  await expect(card).toContainText("S$73.30");
  await expect(card).toContainText("Waiting for approval");
  await shot(ahmad, "my-claims-390");

  // The claim detail on the phone.
  await card.click();
  await expect(ahmad.getByTestId("claim-line")).toHaveCount(2);
  await expect(ahmad.getByText("MYR 125.50 @ 0.301234")).toBeVisible();
  await shot(ahmad, "claim-detail-390");
  const claimUrl = ahmad.url();
  const claimId = claimUrl.split("/claims/")[1] as string;

  // 2. The manager approves in the Inbox, after looking at the receipt.
  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  await kaiWen.goto("/inbox");
  const task = kaiWen
    .getByTestId("inbox-task")
    .filter({ hasText: E2E.members.requester.name })
    .filter({ hasText: /claim/i });
  await task.getByRole("button").first().click();
  const panel = kaiWen.getByTestId("request-panel");
  await expect(panel).toContainText("Mobile phone and Client entertainment claim");
  await expect(panel).toContainText("S$73.30");
  await expect(panel).toContainText("MYR 125.50 @ 0.301234");
  await expect(panel).toContainText("Mobile phone cap");
  await shot(kaiWen, "inbox-claim-1440");
  await panel.getByTestId("request-subject-link").click();
  await expect(kaiWen).toHaveURL(new RegExp(`/claims/${claimId}$`));
  await kaiWen.getByRole("button", { name: /View receipt IMG_4021/ }).click();
  const viewer = kaiWen.getByTestId("receipt-viewer");
  await expect(viewer.getByRole("img", { name: /Receipt IMG_4021/ })).toBeVisible();
  await shot(kaiWen, "receipt-viewer-1440");
  await kaiWen.keyboard.press("Escape");
  await shot(kaiWen, "claim-detail-1440");
  await kaiWen.goto("/inbox");
  await task.getByRole("button").first().click();
  await expect(kaiWen.getByTestId("request-panel")).toContainText("Client entertainment");
  await kaiWen.keyboard.press("a");
  await expect(task).toHaveCount(0);

  // 3. Approved and in the payroll reimbursement source for this period.
  await ahmad.reload();
  await expect(ahmad.getByTestId("claim-status").first()).toHaveText("Approved");
  const owner = await signedIn(browser, E2E.members.owner.email);
  const payable = await owner.request.get(`/api/v1/claims/payable?periodEnd=${periodEnd()}`);
  expect(payable.status()).toBe(200);
  const body = (await payable.json()) as {
    items: { claimId: string; typeName: string; amountCents: number; employeeName: string }[];
  };
  const mine = body.items.filter((i) => i.claimId === claimId);
  expect(mine.map((i) => [i.typeName, i.amountCents]).sort()).toEqual([
    ["Client entertainment", 3780],
    ["Mobile phone", 3550],
  ]);
  expect(mine[0]?.employeeName).toBe(E2E.members.requester.name);
  // Not payable in last month's run (approved today).
  const sg = new Date(Date.now() + 8 * 3_600_000);
  const lastMonthEnd = new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const earlier = (await (await owner.request.get(`/api/v1/claims/payable?periodEnd=${lastMonthEnd}`)).json()) as {
    items: { claimId: string }[];
  };
  expect(earlier.items.some((i) => i.claimId === claimId)).toBe(false);

  // The admin table lists it under "To pay".
  await owner.goto("/claims/admin?status=approved");
  await expect(owner.getByRole("heading", { level: 1, name: "All claims" })).toBeVisible();
  await expect(owner.getByRole("row").filter({ hasText: E2E.members.requester.name })).toContainText("Next payroll");
  for (const p of [ahmad, kaiWen, owner]) await p.context().close();
});

test("screens: claims admin, mark paid outside payroll, settings, phone list", async ({ browser }) => {
  // Farah submits two more claims through the API (one approved and paid by transfer) for a fuller table.
  const farah = await signedIn(browser, E2E.members.shots.email);
  const types = (await (await farah.request.get("/api/v1/claims/eligible-types")).json()) as {
    items: { id: string; code: string }[];
  };
  const typeId = (code: string) => types.items.find((t) => t.code === code)?.id as string;
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const upload = async (seed: number) => {
    const res = await farah.request.post("/api/v1/claims/receipts?fileName=receipt.png", {
      data: receiptPng(seed),
      headers: { "content-type": "application/octet-stream" },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const submit = async (lines: unknown[]) => {
    const res = await farah.request.post("/api/v1/claims", { data: { lines, submit: true } });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const taxi = await submit([
    {
      claimTypeId: typeId("TRANSPORT"),
      expenseDate: today,
      merchant: "Grab",
      description: "Taxi to the Jurong outlet",
      currency: "SGD",
      amountMinor: 1840,
      receiptIds: [],
    },
  ]);
  await submit([
    {
      claimTypeId: typeId("MEALS"),
      expenseDate: today,
      merchant: "Ya Kun",
      description: "Breakfast, stocktake",
      currency: "SGD",
      amountMinor: 1290,
      gstCents: 106,
      receiptIds: [await upload(5)],
    },
    {
      claimTypeId: typeId("TRANSPORT"),
      expenseDate: today,
      merchant: "SMRT",
      description: "MRT to supplier",
      currency: "SGD",
      amountMinor: 230,
      receiptIds: [],
    },
  ]);
  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  const taxiClaim = (await (await farah.request.get(`/api/v1/claims/${taxi}`)).json()) as { approvalRequestId: string };
  const tasks = (await (await kaiWen.request.get("/api/v1/approvals/tasks")).json()) as {
    items: { taskId: string; requestId: string }[];
  };
  const taxiTask = tasks.items.find((t) => t.requestId === taxiClaim.approvalRequestId);
  expect(taxiTask).toBeDefined();
  const decided = await kaiWen.request.post(`/api/v1/approvals/tasks/${taxiTask?.taskId}/decision`, {
    data: { decision: "approve" },
  });
  expect(decided.status(), await decided.text()).toBe(200);

  const owner = await signedIn(browser, E2E.members.owner.email);
  await owner.goto("/claims/admin?status=approved");
  const taxiRow = owner.getByRole("row").filter({ hasText: "Farah Hassan" });
  await expect(taxiRow).toBeVisible();
  await taxiRow.getByRole("checkbox").click();
  await owner.getByTestId("mark-paid").click();
  await owner.getByLabel("Payment reference").fill("FAST 31 Oct");
  await shot(owner, "mark-paid-1440");
  await owner.getByRole("button", { name: "Mark paid", exact: true }).click();
  await expect(owner.getByText("1 claim marked paid")).toBeVisible();
  await owner.goto("/claims/admin?status=all");
  await expect(owner.getByRole("row").filter({ hasText: "FAST 31 Oct" })).toBeVisible();
  await shot(owner, "claims-admin-1440");
  await owner.goto("/claims/admin");
  await shot(owner, "claims-admin-waiting-1440");
  await owner.goto("/settings/claim-types");
  await expect(owner.getByRole("row").filter({ hasText: "Mobile phone" })).toContainText("S$50.00 a month");
  await shot(owner, "settings-claim-types-1440");
  await owner.getByRole("button", { name: "Edit Mobile phone" }).click();
  await shot(owner, "claim-type-dialog-1440");
  await owner.keyboard.press("Escape");

  const phone = await signedIn(browser, E2E.members.shots.email, PHONE);
  await phone.goto("/claims");
  await expect(phone.getByTestId("my-claims-cards").getByRole("link")).toHaveCount(2);
  await shot(phone, "my-claims-farah-390");
  await phone.getByTestId("new-claim").click();
  await phone.getByTestId("claim-line-0").getByRole("radio", { name: "Mobile phone" }).click();
  await shot(phone, "claim-sheet-empty-390");
  const desk = await signedIn(browser, E2E.members.shots.email);
  await desk.goto("/claims");
  await shot(desk, "my-claims-1440");
  await desk.getByTestId("new-claim").click();
  await shot(desk, "claim-sheet-1440");
  for (const p of [farah, kaiWen, owner, phone, desk]) await p.context().close();
});
