import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { recordAudit } from "../../audit/audit.ts";
import { bankAccounts, employees } from "../../db/schema/employees.ts";
import { companyProfiles } from "../../db/schema/organisation.ts";
import { payrollPayslips, payrollRuns, payrollSettings } from "../../db/schema/payroll.ts";
import type { AppDeps } from "../../deps.ts";
import { asAtMany } from "../../employees/effective.ts";
import { AppError } from "../../errors.ts";
import { monthCode, monthLabel } from "../engine/dates.ts";
import { changedPayeesMessage, samePayee, toPayee } from "../payees.ts";
import { loadRun, type PayrollActor } from "../service.ts";
import { buildEzpayFile, type EzpayEmployee, EzpayError, employmentStatus } from "./cpf-ezpay.ts";
import { buildPain001, Pain001Error } from "./pain001.ts";

export interface GeneratedFile {
  fileName: string;
  contentType: string;
  body: string;
  excluded: { employeeName: string; reason: string }[];
}

function singaporeNow(now: Date): { date: string; time: string; iso: string } {
  const sg = new Date(now.getTime() + 8 * 3_600_000).toISOString();
  return { date: sg.slice(0, 10), time: sg.slice(11, 19), iso: `${sg.slice(0, 19)}+08:00` };
}

async function lockedRun(deps: AppDeps, orgId: string, runId: string) {
  const run = await loadRun(deps.db, orgId, runId);
  if (run.status !== "approved" && run.status !== "paid") {
    throw new AppError("conflict", "Files are available once the run is approved.");
  }
  const slips = await deps.db
    .select()
    .from(payrollPayslips)
    .where(and(eq(payrollPayslips.orgId, orgId), eq(payrollPayslips.runId, run.id)));
  slips.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  return { run, slips };
}

/** CPF EZPay (FTP) file for the amounts this run charged (an adjustment or off-cycle run gives a supplementary file). */
export async function cpfEzpayFile(deps: AppDeps, actor: PayrollActor, runId: string): Promise<GeneratedFile> {
  const { run, slips } = await lockedRun(deps, actor.orgId, runId);
  const [profile] = await deps.db.select().from(companyProfiles).where(eq(companyProfiles.orgId, actor.orgId));
  if (!profile?.csn) throw new AppError("conflict", "Add the CPF Submission Number (CSN) in Settings → Company first.");
  const [settings] = await deps.db.select().from(payrollSettings).where(eq(payrollSettings.orgId, actor.orgId));
  const advice = await adviceCodeFor(deps, run, settings?.cpfAdviceCode ?? "01");

  const people = await deps.db
    .select({ id: employees.id, enc: employees.idNumberEnc, idType: employees.idType })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, actor.orgId),
        inArray(
          employees.id,
          slips.map((s) => s.employeeId),
        ),
      ),
    );
  const excluded: GeneratedFile["excluded"] = [];
  const list: EzpayEmployee[] = [];
  for (const s of slips) {
    const r = s.result;
    const shg = Object.fromEntries(
      Object.entries(r.charged.shgCents).filter(([, v]) => (v ?? 0) !== 0),
    ) as EzpayEmployee["shgCents"];
    const liable =
      s.input.employee.residency.status !== "FOREIGNER" && r.cpf !== null && r.cpf.residencyCategory !== "FOREIGNER";
    const hasShg = Object.keys(shg).length > 0;
    if (!liable) {
      if (hasShg) {
        excluded.push({
          employeeName: s.employeeName,
          reason: `Self-help group contribution (${Object.keys(shg).join(", ")}) for an employee without a CPF account: key it in CPF EZPay by hand (the file format needs an S or T number).`,
        });
      }
      continue;
    }
    if (r.charged.cpfTotalCents === 0 && r.totals.owCpfCents === 0 && r.totals.awCpfCents === 0 && !hasShg) continue;
    const p = people.find((x) => x.id === s.employeeId);
    const account = p ? (await deps.secretBox.decrypt("nric", p.enc)).toUpperCase() : "";
    list.push({
      accountNo: account,
      name: s.input.employee.legalName,
      status: employmentStatus(
        s.input.employment.hireDate,
        s.input.employment.lastWorkingDay,
        run.periodStart,
        run.periodEnd,
      ),
      cpfCents: r.charged.cpfTotalCents,
      owCents: r.totals.owCpfCents,
      awCents: r.totals.awCpfCents,
      shgCents: shg,
    });
  }
  const now = singaporeNow(deps.clock.now());
  let file: ReturnType<typeof buildEzpayFile>;
  try {
    file = buildEzpayFile(
      {
        csn: profile.csn,
        adviceCode: advice,
        relevantMonth: run.month,
        createdAt: now,
        employees: list,
        sdlCents: run.totals?.sdlChargedCents ?? 0,
      },
      monthCode(run.month),
    );
  } catch (err) {
    if (err instanceof EzpayError) throw new AppError("conflict", err.message);
    throw err;
  }
  await recordAudit(deps.db, deps, actor.audit, {
    action: "payroll.cpf_file_generated",
    targetType: "payroll_run",
    targetId: run.id,
    meta: {
      fileName: file.fileName,
      records: file.records.length,
      totalCents: file.totalCents,
      excluded: excluded.length,
    },
  });
  return { fileName: file.fileName, contentType: "text/plain; charset=us-ascii", body: file.content, excluded };
}

/** Generic ISO 20022 pain.001.001.03 credit transfers for the run's net pay (not a bank-specific format). */
export async function bankPaymentFile(deps: AppDeps, actor: PayrollActor, runId: string): Promise<GeneratedFile> {
  const { run, slips } = await lockedRun(deps, actor.orgId, runId);
  const [settings] = await deps.db.select().from(payrollSettings).where(eq(payrollSettings.orgId, actor.orgId));
  const [profile] = await deps.db.select().from(companyProfiles).where(eq(companyProfiles.orgId, actor.orgId));
  if (!settings?.debitBankBic || !settings.debitAccountEnc) {
    throw new AppError(
      "conflict",
      "Set the company's bank (SWIFT/BIC) and account number in Payroll settings before downloading the bank file.",
    );
  }
  const accounts = await asAtMany(
    deps.db,
    bankAccounts,
    actor.orgId,
    slips.map((s) => s.employeeId),
    run.payDate,
  );
  // Pay only the accounts the approver saw (finding #10).
  const changed = slips.filter(
    (s) => s.netPayableCents > 0 && !samePayee(s.payee, toPayee(accounts.get(s.employeeId))),
  );
  if (changed.length) {
    throw new AppError(
      "conflict",
      changedPayeesMessage(
        changed.map((s) => s.employeeName),
        "file",
      ),
      { changedPayees: changed.map((s) => s.employeeName) },
    );
  }
  const excluded: GeneratedFile["excluded"] = [];
  const payments = [];
  for (const s of slips) {
    if (s.netPayableCents <= 0) {
      if (s.netPayableCents < 0)
        excluded.push({ employeeName: s.employeeName, reason: "Overpaid in this adjustment: nothing to pay." });
      continue;
    }
    const acct = accounts.get(s.employeeId);
    if (!acct) {
      excluded.push({
        employeeName: s.employeeName,
        reason: `No bank account current on ${run.payDate}: pay by cheque or add the account in People.`,
      });
      continue;
    }
    payments.push({
      endToEndId: `${run.month.replace("-", "")}-${s.employeeNumber}`,
      amountCents: s.netPayableCents,
      creditorName: acct.holderName,
      creditorBic: acct.bankCode,
      creditorAccount: await deps.secretBox.decrypt("bank-account", acct.accountNumberEnc),
      remittance: `Salary ${monthLabel(run.month)}${run.kind === "adjustment" ? " adjustment" : ""}`,
    });
  }
  const now = singaporeNow(deps.clock.now());
  let body: string;
  try {
    body = buildPain001({
      messageId: `CROWHR-${run.month.replace("-", "")}-${run.id.slice(-8).toUpperCase()}`,
      createdAt: now.iso,
      initiatingParty: profile?.legalName ?? settings.debitAccountName ?? "Employer",
      requestedExecutionDate: run.payDate,
      debtor: {
        name: settings.debitAccountName ?? profile?.legalName ?? "Employer",
        bic: settings.debitBankBic,
        account: await deps.secretBox.decrypt("bank-account", settings.debitAccountEnc),
      },
      payments,
    });
  } catch (err) {
    if (err instanceof Pain001Error) throw new AppError("conflict", err.message);
    throw err;
  }
  await recordAudit(deps.db, deps, actor.audit, {
    action: "payroll.bank_file_generated",
    targetType: "payroll_run",
    targetId: run.id,
    meta: { payments: payments.length, excluded: excluded.length, format: "pain.001.001.03" },
  });
  return {
    fileName: `salary-${run.month}-${run.kind}-pain001.xml`,
    contentType: "application/xml",
    body,
    excluded,
  };
}

/**
 * The run's CPF EZPay advice code, allocated once and kept on the run (Crow HR's bookkeeping policy:
 * the FTP spec allows 01–99 and needs distinct codes for advices in one file, but prescribes no
 * sequence). The regular run takes the configured code when free; later runs of the month take the
 * next unused code. Past 99 there is no code left: refuse rather than reuse one.
 */
async function adviceCodeFor(
  deps: AppDeps,
  run: { id: string; orgId: string; month: string; kind: string; cpfAdviceCode: string | null },
  base: string,
): Promise<string> {
  if (run.cpfAdviceCode) return run.cpfAdviceCode;
  return deps.db.transaction(async (tx) => {
    const used = await tx
      .select({ code: payrollRuns.cpfAdviceCode })
      .from(payrollRuns)
      .where(
        and(eq(payrollRuns.orgId, run.orgId), eq(payrollRuns.month, run.month), isNotNull(payrollRuns.cpfAdviceCode)),
      );
    const taken = new Set(used.map((u) => Number(u.code)));
    let code = Number(base);
    if (run.kind !== "regular" || taken.has(code)) code = Math.max(Number(base), ...taken) + (taken.size ? 1 : 0);
    while (taken.has(code)) code++;
    if (code > 99) {
      throw new AppError(
        "conflict",
        `Every CPF EZPay advice code (01–99) for ${run.month} is used. Submit the remaining amounts in CPF EZPay by hand, or set a lower base advice code in Payroll settings.`,
      );
    }
    const value = String(code).padStart(2, "0");
    await tx
      .update(payrollRuns)
      .set({ cpfAdviceCode: value })
      .where(and(eq(payrollRuns.orgId, run.orgId), eq(payrollRuns.id, run.id)));
    return value;
  });
}
