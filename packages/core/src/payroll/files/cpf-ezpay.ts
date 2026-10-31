/**
 * CPF EZPay (FTP) submission file, per CPF Board's "CPF EZPay (FTP) File Specifications (effective
 * from 16 January 2025)":
 * https://www.cpf.gov.sg/content/dam/web/employer/making-cpf-contributions/documents/CPFEZPayFTPSpecifications.pdf
 * (read 31 Oct 2026; research/sg-regulatory.md §9). Fixed-length 150-byte records: employer header,
 * contribution summary per payment code (record type 0), contribution details for codes 01–05
 * (record type 1) and an employer trailer (record type 9).
 *
 * The employer uploads the file inside CPF EZPay; Crow HR never submits it (no public API).
 */

export const EZPAY_SPEC_SOURCE =
  "https://www.cpf.gov.sg/content/dam/web/employer/making-cpf-contributions/documents/CPFEZPayFTPSpecifications.pdf";

export const RECORD_LENGTH = 150;

/** Payment codes (spec, summary record cols 27–28). */
export const PAYMENT_CODES = {
  CPF: "01",
  MBMF: "02",
  SINDA: "03",
  CDAC: "04",
  ECF: "05",
  PENALTY_INTEREST: "07",
  COMMUNITY_CHEST: "10",
  SDL: "11",
} as const;
export type PaymentCode = (typeof PAYMENT_CODES)[keyof typeof PAYMENT_CODES];

/** Spec note 2: "Please do not include any negative amounts or the following characters in your file". */
export const FORBIDDEN_CHARACTERS = '_+$<>:;?!=[]`^|\\"~';

export type EmploymentStatus = "E" | "L" | "N" | "O";

export interface EzpayEmployee {
  /** CPF account number (NRIC): 9 characters, first S or T, last the check digit (spec detail cols 29–37). */
  accountNo: string;
  name: string;
  status: EmploymentStatus;
  /** Relevant month `YYYY-MM` (defaults to the file's month). */
  relevantMonth?: string;
  cpfCents: number;
  owCents: number;
  awCents: number;
  shgCents: Partial<Record<"MBMF" | "SINDA" | "CDAC" | "ECF", number>>;
}

export interface EzpayInput {
  /** CPF Submission Number: UEN/NRIC/FIN + payment type + serial, e.g. `234567891APTE01`. */
  csn: string;
  adviceCode: string;
  relevantMonth: string;
  /** File creation date and time (Singapore time). */
  createdAt: { date: string; time: string };
  employees: EzpayEmployee[];
  sdlCents: number;
  /** Payment codes to list even with a zero amount (CPF's sample lists 07, 10 and 11). */
  zeroSummaries?: PaymentCode[];
}

export class EzpayError extends Error {
  override name = "EzpayError";
}

const SHG_CODE = { MBMF: "02", SINDA: "03", CDAC: "04", ECF: "05" } as const;

function num(value: number, digits: number, field: string): string {
  if (!Number.isSafeInteger(value)) throw new EzpayError(`${field} must be whole cents.`);
  if (value < 0)
    throw new EzpayError(
      `${field} is negative (${value / 100}). CPF EZPay files may not contain negative amounts: claim the refund from CPF Board instead.`,
    );
  const s = String(value);
  if (s.length > digits) throw new EzpayError(`${field} (${value / 100}) is too large for its ${digits}-digit field.`);
  return s.padStart(digits, "0");
}

function text(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, " ");
}

/** Removes characters the spec forbids and anything outside printable ASCII; collapses spaces. */
export function sanitiseName(name: string): string {
  const out = [...name.normalize("NFKD")]
    .filter((c) => c >= " " && c <= "~" && !FORBIDDEN_CHARACTERS.includes(c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return out;
}

export function parseCsn(csn: string): { uen: string; paymentType: string; serial: string } {
  const m = /^([A-Z0-9]{9,10})([A-Z]{3})(\d{2})$/.exec(csn.trim().toUpperCase());
  if (!m)
    throw new EzpayError(
      `The CPF Submission Number "${csn}" is not UEN + payment type + 2-digit serial (e.g. 201912345KPTE01). Correct it in Settings → Company.`,
    );
  return { uen: m[1] as string, paymentType: m[2] as string, serial: m[3] as string };
}

const yyyymm = (month: string) => month.replace("-", "");

export interface EzpayFile {
  fileName: string;
  content: string;
  records: string[];
  totalCents: number;
}

/**
 * Builds the file. Throws `EzpayError` with a fix-it message on anything the spec forbids (negative
 * amount, bad CSN or advice code, account number not starting with S or T).
 */
export function buildEzpayFile(input: EzpayInput, fileMonthCode: string): EzpayFile {
  const { uen, paymentType, serial } = parseCsn(input.csn);
  if (!/^(0[1-9]|[1-9]\d)$/.test(input.adviceCode))
    throw new EzpayError("The advice code must be two digits from 01 to 99.");
  if (!/^\d{4}-\d{2}$/.test(input.relevantMonth)) throw new EzpayError("Relevant month must be YYYY-MM.");
  const prefix = (type: string) => `F${type}${text(uen, 10)}${paymentType}${serial} ${input.adviceCode}`;

  const header = `${prefix(" ")}${input.createdAt.date.replace(/-/g, "")}${input.createdAt.time.replace(/:/g, "")}${text("FTP.DTL", 13)}${" ".repeat(103)}`;

  type Detail = { month: string; account: string; code: string; line: string };
  const details: Detail[] = [];
  const sums = new Map<string, { amount: number; donors: number }>();
  const addSum = (month: string, code: string, cents: number, donor: boolean) => {
    const key = `${month}|${code}`;
    const s = sums.get(key) ?? { amount: 0, donors: 0 };
    s.amount += cents;
    if (donor) s.donors += 1;
    sums.set(key, s);
  };
  for (const e of input.employees) {
    const account = e.accountNo.trim().toUpperCase();
    if (!/^[ST]\d{7}[A-Z]$/.test(account)) {
      throw new EzpayError(
        `${e.name}: CPF account number must start with S or T and end with the check letter (spec page 4). Foreign employees without CPF accounts cannot be listed.`,
      );
    }
    const month = e.relevantMonth ?? input.relevantMonth;
    const name = text(sanitiseName(e.name), 66);
    details.push({
      month,
      account,
      code: PAYMENT_CODES.CPF,
      line: `${prefix("1")}${yyyymm(month)}${PAYMENT_CODES.CPF}${account}${num(e.cpfCents, 12, `${e.name} CPF`)}${num(e.owCents, 10, `${e.name} ordinary wages`)}${num(e.awCents, 10, `${e.name} additional wages`)}${e.status}${name}${" ".repeat(14)}`,
    });
    addSum(month, PAYMENT_CODES.CPF, e.cpfCents, false);
    for (const [fund, code] of Object.entries(SHG_CODE) as [keyof typeof SHG_CODE, string][]) {
      const cents = e.shgCents[fund] ?? 0;
      if (cents === 0) continue;
      details.push({
        month,
        account,
        code,
        line: `${prefix("1")}${yyyymm(month)}${code}${account}${num(cents, 12, `${e.name} ${fund}`)}${"0".repeat(10)}${"0".repeat(10)} ${name}${" ".repeat(14)}`,
      });
      addSum(month, code, cents, true);
    }
  }
  if (input.sdlCents !== 0) addSum(input.relevantMonth, PAYMENT_CODES.SDL, input.sdlCents, false);
  if (!sums.has(`${input.relevantMonth}|${PAYMENT_CODES.CPF}`))
    addSum(input.relevantMonth, PAYMENT_CODES.CPF, 0, false);
  for (const code of input.zeroSummaries ?? []) {
    if (!sums.has(`${input.relevantMonth}|${code}`)) addSum(input.relevantMonth, code, 0, false);
  }
  const DONOR_CODES = new Set(["02", "03", "04", "05", "10"]);
  const summaries = [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, s]) => {
      const [month, code] = key.split("|") as [string, string];
      return `${prefix("0")}${yyyymm(month)}${code}${num(s.amount, 12, `Summary ${code}`)}${num(DONOR_CODES.has(code) ? s.donors : 0, 7, "Donor count")}${" ".repeat(103)}`;
    });
  details.sort(
    (a, b) => a.month.localeCompare(b.month) || a.account.localeCompare(b.account) || a.code.localeCompare(b.code),
  );
  const total = [...sums.values()].reduce((s, v) => s + v.amount, 0);
  const count = 1 + summaries.length + details.length + 1;
  const trailer = `${prefix("9")}${num(count, 7, "Record count")}${num(total, 15, "Total amount")}${" ".repeat(108)}`;
  const records = [header, ...summaries, ...details.map((d) => d.line), trailer];
  for (const [i, r] of records.entries()) {
    if (r.length !== RECORD_LENGTH)
      throw new Error(`EZPay record ${i + 1} is ${r.length} bytes, not ${RECORD_LENGTH}.`);
  }
  return {
    fileName: `${uen}${paymentType}${serial}${fileMonthCode}${input.adviceCode}.DTL`,
    content: `${records.join("\r\n")}\r\n`,
    records,
    totalCents: total,
  };
}

/** E/L/N/O from join and leave dates within the month (spec detail col 70). */
export function employmentStatus(
  hireDate: string,
  lastWorkingDay: string | null,
  periodStart: string,
  periodEnd: string,
): EmploymentStatus {
  const joined = hireDate >= periodStart && hireDate <= periodEnd;
  const left = lastWorkingDay !== null && lastWorkingDay >= periodStart && lastWorkingDay <= periodEnd;
  if (joined && left) return "O";
  if (joined) return "N";
  if (left) return "L";
  return "E";
}
