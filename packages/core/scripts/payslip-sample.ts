/**
 * DEV ONLY: writes a sample payslip PDF from fictional data, for eyeballing the layout.
 *   node packages/core/scripts/payslip-sample.ts out.pdf
 */
import { writeFileSync } from "node:fs";
import { computeEmployeePay } from "../src/payroll/engine/compute.ts";
import { buildPayslipView } from "../src/payroll/payslip.ts";
import { renderPayslipPdf } from "../src/payroll/payslip-pdf.ts";
import { item, payInput } from "../src/testing/payroll-input.ts";

const input = payInput({
  run: { payDate: "2026-10-30" },
  compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 260_000 }],
  allowances: [
    {
      id: "a1",
      code: "TRANSPORT",
      name: "Transport allowance",
      amountCents: 20_000,
      from: "2020-01-01",
      to: null,
      cpfLiable: true,
      prorate: true,
    },
  ],
  items: [
    item({ kind: "overtime", label: "Overtime", minutes: 150, periodStart: "2026-09-21", periodEnd: "2026-10-20" }),
    item({ kind: "commission", label: "Sales commission", amountCents: 15_000, wageClass: "OW" }),
    item({ kind: "unpaid_leave", label: "No-pay leave", days: 1 }),
    item({ kind: "deduction", label: "Staff uniform", amountCents: 3_000, deductionCategory: "consented" }),
  ],
  reimbursements: [{ claimId: "c1", typeName: "Transport", amountCents: 4_550 }],
});
const view = buildPayslipView(
  {
    id: "0190f3c2-0000-7000-8000-00000000abcd",
    runId: "run",
    input,
    result: computeEmployeePay(input),
    releasedAt: new Date(),
  },
  { kind: "regular", offCycleReason: null, adjustsRunId: null, month: "2026-10" },
  "October 2026",
);
writeFileSync(
  process.argv[2] ?? "payslip-sample.pdf",
  await renderPayslipPdf(view, { createdAt: new Date("2026-10-30T02:00:00Z") }),
);
