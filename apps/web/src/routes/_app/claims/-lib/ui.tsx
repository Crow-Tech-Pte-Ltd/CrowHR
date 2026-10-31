import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  formatMoney,
  StatusPill,
} from "@crowhr/ui";
import { Download, FileText, ImageOff, ShieldAlert } from "lucide-react";
import * as React from "react";
import { type ClaimFileDto, type ClaimStatus, STATUS_LABEL, STATUS_TONE } from "./api.ts";
import { exponentOf, formatMinorAmount } from "./money.ts";

export function ClaimStatusPill({ status, className }: { status: ClaimStatus; className?: string }) {
  return (
    <StatusPill tone={STATUS_TONE[status]} className={className} data-testid="claim-status">
      {STATUS_LABEL[status]}
    </StatusPill>
  );
}

/** "MYR 125.50" for foreign amounts (SGD lines show only the S$ amount). */
export function foreignAmount(currency: string, amountMinor: number): string {
  return `${currency} ${formatMinorAmount(amountMinor, exponentOf(currency))}`;
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("num", className)}>{formatMoney(cents)}</span>;
}

/** "S$54.40 left of S$100.00 this month" — the live cap line on the claim form. */
export function CapRemaining({
  cap,
  thisClaimCents,
}: {
  cap: { capCents: number; usedCents: number; pendingCents: number; period: string; periodLabel: string };
  thisClaimCents: number;
}) {
  const left = cap.capCents - cap.usedCents - cap.pendingCents - thisClaimCents;
  const when =
    cap.period === "per_claim"
      ? "per claim"
      : cap.period === "monthly"
        ? `in ${cap.periodLabel}`
        : `in ${cap.periodLabel}`;
  const over = left < 0;
  return (
    <p
      className={cn("num text-2xs", over ? "font-semibold text-danger-300" : "text-primary-300")}
      data-testid="cap-remaining"
      aria-live="polite"
    >
      {over
        ? `${formatMoney(-left)} over the ${formatMoney(cap.capCents)} cap ${when}`
        : `${formatMoney(left)} left of ${formatMoney(cap.capCents)} ${when}`}
    </p>
  );
}

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A receipt chip: thumbnail for images, an icon for PDF/HEIC; opens the viewer. */
export function ReceiptChip({
  file,
  onOpen,
  onRemove,
}: {
  file: ClaimFileDto;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-50 p-1.5 pr-2">
      <button
        type="button"
        onClick={onOpen}
        className="focus-ring flex min-w-0 items-center gap-2 rounded-sm text-left"
        aria-label={`View receipt ${file.name}`}
      >
        {file.previewable ? (
          <img src={file.url} alt="" className="size-9 shrink-0 rounded-sm border border-border object-cover" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-100">
            <FileText className="size-4 text-primary-300" aria-hidden />
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-ui">{file.name}</span>
          <span className="num block text-2xs text-primary-200">
            {sizeLabel(file.sizeBytes)}
            {file.scanStatus === "pending_scan" ? " · scanning" : ""}
            {file.scanStatus === "scan_failed" ? " · scan failed" : ""}
          </span>
        </span>
      </button>
      {onRemove ? (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${file.name}`}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}

/** Receipt viewer: images inline, PDF and HEIC as downloads (they're served as attachments). */
export function ReceiptViewer({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: ClaimFileDto[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const current = index === null ? null : (files[index] ?? null);
  // Keep the last file on screen while the dialog animates closed (no empty frame).
  const last = React.useRef<ClaimFileDto | null>(null);
  if (current) last.current = current;
  const file = current ?? last.current;
  React.useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, files.length, onIndex]);
  return (
    <Dialog open={current !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-3xl" data-testid="receipt-viewer">
        {file ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
              <DialogDescription className="num">
                {files.length > 1 ? `Receipt ${(index ?? 0) + 1} of ${files.length} · ` : ""}
                {sizeLabel(file.sizeBytes)}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-48 items-center justify-center rounded-md border border-border bg-surface-100 p-2">
              {file.removed ? (
                <p className="flex items-center gap-2 p-8 text-ui text-danger-300">
                  <ShieldAlert className="size-4" aria-hidden /> The virus scanner removed this file.
                </p>
              ) : file.previewable ? (
                <img src={file.url} alt={`Receipt ${file.name}`} className="max-h-[65dvh] w-auto object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-3 p-8 text-center">
                  {file.mime === "image/heic" ? (
                    <ImageOff className="size-6 text-primary-200" aria-hidden />
                  ) : (
                    <FileText className="size-6 text-primary-200" aria-hidden />
                  )}
                  <p className="text-ui text-primary-300">
                    {file.mime === "image/heic"
                      ? "Preview not available. Download to view."
                      : "PDF receipts open in your PDF viewer."}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button size="sm" disabled={!index} onClick={() => onIndex((index ?? 0) - 1)}>
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={index === null || index >= files.length - 1}
                  onClick={() => onIndex((index ?? 0) + 1)}
                >
                  Next
                </Button>
              </div>
              {!file.removed ? (
                <Button size="sm" variant="secondary" asChild>
                  <a href={`${file.url}?download=1`} download={file.name}>
                    <Download aria-hidden /> Download
                  </a>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export const CATEGORY_LABEL: Record<string, string> = {
  medical: "Medical",
  dental: "Dental",
  transport: "Transport",
  meals: "Meals",
  entertainment: "Entertainment",
  travel: "Travel",
  phone: "Phone",
  training: "Training",
  other: "Other",
};
