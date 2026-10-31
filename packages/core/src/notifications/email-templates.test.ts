import { describe, expect, it } from "vitest";
import { containsSensitive, EMAIL_KINDS, renderEmail, safePayload, scrubSensitive } from "./email-templates.ts";

const ORG = { name: "Kampong Kopi Pte. Ltd." };
const URL = "https://hr.kampongkopi.example";
const NRIC = /\b[STFGM]\d{7}[A-Z]\b/i;
const MONEY = /S\$|SGD|\$\s?\d/;
const BANK = /\d{6,}/;

describe("email templates", () => {
  it("every kind renders a subject, text and HTML with the org name and link", () => {
    for (const kind of EMAIL_KINDS) {
      const out = renderEmail(kind, { headline: "Ravi Kumar sent a leave request.", linkPath: "/inbox" }, ORG, URL);
      expect(out.subject).toMatch(/· Kampong Kopi Pte\. Ltd\.$/);
      expect(out.text).toContain("Kampong Kopi Pte. Ltd.");
      expect(out.text).toContain(`${URL}/inbox`);
      expect(out.html).toContain(`href="${URL}/inbox"`);
      expect(out.html).toContain("#f5d000"); // the yellow accent bar
    }
  });

  it("payload types reject money and ID fields at compile time", () => {
    // @ts-expect-error amountCents is not allowed in an email payload
    safePayload({ headline: "x", linkPath: "/", amountCents: 62_000 });
    // @ts-expect-error nric is not allowed in an email payload
    safePayload({ headline: "x", linkPath: "/", nric: "S1234567D" });
    // @ts-expect-error bankAccount is not allowed in an email payload
    safePayload({ headline: "x", linkPath: "/", bankAccount: "1234567890" });
    expect(safePayload({ headline: "x", linkPath: "/" })).toEqual({ headline: "x", linkPath: "/" });
  });

  it("rendered bodies contain no S$ amounts, NRIC/FIN or bank numbers even if a module leaks one", () => {
    const leaky = {
      headline: "Your payslip for S$4,250.00 is ready (S1234567D, account 123-456789-001)",
      detail: "Net pay $3,812.50 to DBS 0123456789; FIN G7654321K",
      linkPath: "/payroll/payslips",
    };
    for (const kind of EMAIL_KINDS) {
      const out = renderEmail(kind, leaky, ORG, URL);
      for (const body of [out.text, out.html, out.subject]) {
        expect(body).not.toMatch(MONEY);
        expect(body).not.toMatch(NRIC);
        // Ignore the URL and the CSS colour codes of the HTML part.
        expect(body.replace(URL, "").replace(/#[0-9a-f]{6}/gi, "")).not.toMatch(BANK);
      }
    }
  });

  it("payslip email: no money amount, links to the payslip in the app", () => {
    const out = renderEmail(
      "payslip_released",
      { headline: "Your October 2026 payslip is ready.", linkPath: "/payroll/payslips/2026-10" },
      ORG,
      URL,
    );
    expect(out.subject).toBe("Your payslip is ready · Kampong Kopi Pte. Ltd.");
    expect(out.text).not.toMatch(MONEY);
    expect(out.text).toContain(`${URL}/payroll/payslips/2026-10`);
  });

  it("scrubs and detects sensitive values", () => {
    expect(scrubSensitive("Claim S$620.00 approved")).toBe("Claim [hidden] approved");
    expect(containsSensitive("T0123456Z")).toBe(true);
    expect(containsSensitive("Annual leave, 4–6 Nov 2026")).toBe(false);
  });

  it("escapes HTML in names", () => {
    const out = renderEmail(
      "task_assigned",
      { headline: "<script>x</script> sent a request", linkPath: "/inbox" },
      ORG,
      URL,
    );
    expect(out.html).not.toContain("<script>");
  });
});
