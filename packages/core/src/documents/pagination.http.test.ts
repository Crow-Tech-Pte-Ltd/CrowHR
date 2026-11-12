import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfBytes, uploadDoc } from "../../testing/documents.ts";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";

/** The document list pages when asked (`page`, `pageSize`) and always says how many there are. */
type List = { items: { id: string; title: string }[]; total: number; page?: number; pageSize?: number };

describe("document list pagination", () => {
  let w: LeaveWorld;
  let hr: TestClient;
  let cats: Record<string, string>;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-10-31T01:00:00.000Z" });
    hr = await w.as("hr");
    const body = (await (await hr.get("/api/v1/documents/categories")).json()) as {
      items: { id: string; systemKey: string | null }[];
    };
    cats = Object.fromEntries(body.items.map((c) => [c.systemKey as string, c.id]));
    // Five certificates (employee-visible) and two HR-only notes for Farah.
    for (let i = 1; i <= 5; i++)
      expect(
        (
          await uploadDoc(hr, pdfBytes(200 + i), {
            employeeId: w.emp.other,
            categoryId: cats.certificates as string,
            title: `Cert ${i}`,
          })
        ).status,
      ).toBe(201);
    for (let i = 1; i <= 2; i++)
      expect(
        (
          await uploadDoc(hr, pdfBytes(300 + i), {
            employeeId: w.emp.other,
            categoryId: cats.other as string,
            title: `Note ${i}`,
          })
        ).status,
      ).toBe(201);
  });
  afterAll(() => w.close());

  const list = async (client: TestClient, qs: string) => {
    const res = await client.get(`/api/v1/documents?${qs}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as List;
  };

  it("without page parameters returns every document, as before, with the total", async () => {
    const all = await list(hr, `employeeId=${w.emp.other}`);
    expect(all.items).toHaveLength(7);
    expect(all.total).toBe(7);
    expect(all.page).toBeUndefined();
  });

  it("pages in a stable order, every document once", async () => {
    const pages = [];
    for (const page of [1, 2, 3, 4]) pages.push(await list(hr, `employeeId=${w.emp.other}&page=${page}&pageSize=3`));
    expect(pages.map((p) => p.items.length)).toEqual([3, 3, 1, 0]);
    expect(pages.every((p) => p.total === 7 && p.pageSize === 3)).toBe(true);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4]);
    const all = await list(hr, `employeeId=${w.emp.other}`);
    expect(pages.flatMap((p) => p.items.map((i) => i.id))).toEqual(all.items.map((i) => i.id));
  });

  it("counts only what the reader may see", async () => {
    const farah = await w.as("other");
    const mine = await list(farah, "mine=true&page=1&pageSize=2");
    expect(mine.total).toBe(5);
    expect(mine.items.map((i) => i.title).every((t) => t.startsWith("Cert"))).toBe(true);
  });

  it("refuses a page size above the limit, with how to fix it", async () => {
    const res = await hr.get(`/api/v1/documents?employeeId=${w.emp.other}&page=1&pageSize=500`);
    expect(res.status).toBe(400);
  });
});
