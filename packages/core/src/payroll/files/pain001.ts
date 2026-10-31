/**
 * Generic ISO 20022 customer credit transfer initiation, `pain.001.001.03`, for salary payments
 * (category purpose SALA). Singapore's corporate-to-bank standard SS611 adopts pain.001.001.03 and
 * leaves message details to each bank; banks publish their own guides (e.g. ANZ's Singapore MIG
 * requires SvcLvl URNS for FAST and 11-character BICs). Service level, charge bearer and BIC length
 * are therefore bank- and rail-profile dependent (payroll-choices.md §7). This writer is generic:
 * no bank profile is applied, and the employer must test the file with their bank before first use.
 *
 * NOT a bank-specific format; not validated by any bank.
 */

export const PAIN001_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";

export interface Pain001Payment {
  endToEndId: string;
  amountCents: number;
  creditorName: string;
  creditorBic: string;
  creditorAccount: string;
  remittance: string;
}

export interface Pain001Input {
  messageId: string;
  createdAt: string; // ISO date-time
  initiatingParty: string;
  requestedExecutionDate: string;
  debtor: { name: string; bic: string; account: string };
  payments: Pain001Payment[];
}

export class Pain001Error extends Error {
  override name = "Pain001Error";
}

export function xmlEscape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string,
  );
}

/** ISO 20022 "Max35Text"/"Max140Text": trim and cut; keep to the SWIFT-safe Latin character set. */
function max(s: string, n: number): string {
  const ascii = [...s.normalize("NFKD")]
    .filter((c) => /[A-Za-z0-9/\-?:().,'+ ]/.test(c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return ascii.slice(0, n);
}

function amount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Pain001Error("Payment amounts must be positive whole cents.");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function buildPain001(input: Pain001Input): string {
  if (input.payments.length === 0) throw new Pain001Error("There are no payments to include.");
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(input.debtor.bic)) {
    throw new Pain001Error(
      "Set the company's bank (SWIFT/BIC) and account in Payroll settings before downloading the bank file.",
    );
  }
  const total = input.payments.reduce((s, p) => s + p.amountCents, 0);
  const tx = input.payments
    .map(
      (p) => `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${xmlEscape(max(p.endToEndId, 35))}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="SGD">${amount(p.amountCents)}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId>
            <BIC>${xmlEscape(p.creditorBic)}</BIC>
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${xmlEscape(max(p.creditorName, 140))}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>${xmlEscape(p.creditorAccount)}</Id>
            </Othr>
          </Id>
        </CdtrAcct>
        <Purp>
          <Cd>SALA</Cd>
        </Purp>
        <RmtInf>
          <Ustrd>${xmlEscape(max(p.remittance, 140))}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${PAIN001_NAMESPACE}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(max(input.messageId, 35))}</MsgId>
      <CreDtTm>${input.createdAt}</CreDtTm>
      <NbOfTxs>${input.payments.length}</NbOfTxs>
      <CtrlSum>${amount(total)}</CtrlSum>
      <InitgPty>
        <Nm>${xmlEscape(max(input.initiatingParty, 140))}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xmlEscape(max(input.messageId, 35))}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${input.payments.length}</NbOfTxs>
      <CtrlSum>${amount(total)}</CtrlSum>
      <PmtTpInf>
        <CtgyPurp>
          <Cd>SALA</Cd>
        </CtgyPurp>
      </PmtTpInf>
      <ReqdExctnDt>${input.requestedExecutionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${xmlEscape(max(input.debtor.name, 140))}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>${xmlEscape(input.debtor.account)}</Id>
          </Othr>
        </Id>
        <Ccy>SGD</Ccy>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>${xmlEscape(input.debtor.bic)}</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
