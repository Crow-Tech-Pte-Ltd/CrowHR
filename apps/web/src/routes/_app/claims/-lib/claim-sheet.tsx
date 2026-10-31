import {
  Alert,
  AlertDescription,
  Button,
  cn,
  formatMoney,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  toast,
  toIsoDate,
} from "@crowhr/ui";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import {
  api,
  type ClaimDto,
  type ClaimFileDto,
  claimKeys,
  type EligibleClaimTypeDto,
  eligibleTypesQuery,
  errorCode,
  errorDetails,
  errorMessage,
  fieldErrors,
  type LineDraft,
  uploadReceipt,
} from "./api.ts";
import { CURRENCIES, exponentOf, formatMinorAmount, parseMinor, previewSgd } from "./money.ts";
import { CapRemaining, ReceiptChip, ReceiptViewer } from "./ui.tsx";

/** One line as typed (text fields keep what the person typed; numbers are derived). */
interface FormLine {
  key: string;
  claimTypeId: string;
  expenseDate: string;
  merchant: string;
  description: string;
  currency: string;
  amountText: string;
  rate: string;
  gstText: string;
  showGst: boolean;
  receipts: ClaimFileDto[];
  uploading: number;
}

let keySeq = 0;
const today = () => toIsoDate(new Date());

function emptyLine(defaults: Partial<FormLine> = {}): FormLine {
  return {
    key: `l${++keySeq}`,
    claimTypeId: "",
    expenseDate: today(),
    merchant: "",
    description: "",
    currency: "SGD",
    amountText: "",
    rate: "",
    gstText: "",
    showGst: false,
    receipts: [],
    uploading: 0,
    ...defaults,
  };
}

function fromClaim(claim: ClaimDto): FormLine[] {
  return claim.lines.map((l) =>
    emptyLine({
      claimTypeId: l.claimTypeId,
      expenseDate: l.expenseDate,
      merchant: l.merchant ?? "",
      description: l.description ?? "",
      currency: l.currency,
      amountText: formatMinorAmount(l.amountMinor, exponentOf(l.currency)).replace(/,/g, ""),
      rate: l.rate ?? "",
      gstText: l.gstCents ? formatMinorAmount(l.gstCents, 2) : "",
      showGst: !!l.gstCents,
      receipts: l.receipts ?? [],
    }),
  );
}

const amountOf = (l: FormLine) => parseMinor(l.amountText, exponentOf(l.currency));
const sgdOf = (l: FormLine) => previewSgd(l.currency, amountOf(l), l.rate || null);
const gstOf = (l: FormLine) => (l.currency === "SGD" && l.showGst && l.gstText ? parseMinor(l.gstText, 2) : null);

function periodKey(type: EligibleClaimTypeDto, date: string): string {
  const p = type.cap?.period;
  return p === "monthly" ? date.slice(0, 7) : p === "yearly" ? date.slice(0, 4) : "claim";
}

function useIsMobile() {
  const [mobile, setMobile] = React.useState(() => window.matchMedia("(max-width: 639px)").matches);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

/**
 * New claim / edit draft. Mobile-first: snap the receipt first (camera via `<input capture>`),
 * then amount, type and date; the remaining cap for the type updates as you type. Multi-line,
 * foreign currency with a manual rate and a live SGD preview, optional GST.
 */
export function ClaimSheet({
  open,
  onOpenChange,
  draft,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this draft instead of creating a new claim. */
  draft?: ClaimDto | null;
  onDone?: (claim: ClaimDto) => void;
}) {
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const [lines, setLines] = React.useState<FormLine[]>(() => (draft ? fromClaim(draft) : [emptyLine()]));
  const [draftId, setDraftId] = React.useState<string | null>(draft?.id ?? null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [viewer, setViewer] = React.useState<{ line: number; index: number } | null>(null);

  React.useEffect(() => {
    if (open) {
      setLines(draft ? fromClaim(draft) : [emptyLine()]);
      setDraftId(draft?.id ?? null);
      setErrors({});
      setFormError(null);
    }
  }, [open, draft]);

  const dates = [...new Set(lines.map((l) => l.expenseDate || today()))];
  const typeQueries = useQueries({
    queries: dates.map((d) => ({ ...eligibleTypesQuery(d, { excludeClaimId: draftId ?? undefined }), enabled: open })),
  });
  const typesByDate = new Map(dates.map((d, i) => [d, typeQueries[i]?.data?.items ?? []]));
  const types = typeQueries[0]?.data?.items ?? [];
  const typesLoading = typeQueries.some((q) => q.isPending);

  const update = (key: string, patch: Partial<FormLine> | ((l: FormLine) => Partial<FormLine>)) =>
    setLines((ls) =>
      ls.map((l) => (l.key === key ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)),
    );

  const addFiles = async (key: string, files: FileList | null) => {
    if (!files?.length) return;
    for (const file of [...files]) {
      update(key, (l) => ({ uploading: l.uploading + 1 }));
      try {
        const uploaded = await uploadReceipt(file);
        update(key, (l) => ({ receipts: [...l.receipts, uploaded], uploading: l.uploading - 1 }));
      } catch (err) {
        update(key, (l) => ({ uploading: l.uploading - 1 }));
        toast.error(errorMessage(err));
      }
    }
  };

  const total = lines.reduce((s, l) => s + (sgdOf(l) ?? 0), 0);

  const payload = (): { lines: LineDraft[] } | null => {
    const errs: Record<string, string> = {};
    const out: LineDraft[] = [];
    lines.forEach((l, i) => {
      const amount = amountOf(l);
      if (!l.claimTypeId) errs[`lines.${i}.claimTypeId`] = "Pick what the expense was for.";
      if (amount === null)
        errs[`lines.${i}.amountMinor`] =
          exponentOf(l.currency) === 0 ? "Enter a whole amount, e.g. 5000." : "Enter the amount, e.g. 45.60.";
      if (l.currency !== "SGD" && previewSgd(l.currency, amount, l.rate || null) === null)
        errs[`lines.${i}.rate`] = `Enter SGD per 1 ${l.currency}, up to 6 decimal places.`;
      if (l.showGst && l.gstText && gstOf(l) === null) errs[`lines.${i}.gstCents`] = "Enter the GST, e.g. 3.76.";
      if (l.uploading) errs[`lines.${i}.receiptIds`] = "Wait for the receipt to finish uploading.";
      out.push({
        claimTypeId: l.claimTypeId,
        expenseDate: l.expenseDate,
        merchant: l.merchant,
        description: l.description,
        currency: l.currency,
        amountMinor: amount ?? 0,
        rate: l.currency === "SGD" ? null : l.rate || null,
        gstCents: gstOf(l),
        receiptIds: l.receipts.map((r) => r.id),
      });
    });
    setErrors(errs);
    return Object.keys(errs).length ? null : { lines: out };
  };

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const body = payload();
      if (!body) throw new Error("fix-fields");
      if (draftId) {
        await api<ClaimDto>("PUT", `/claims/${draftId}`, body);
        return submit ? api<ClaimDto>("POST", `/claims/${draftId}/submit`) : api<ClaimDto>("GET", `/claims/${draftId}`);
      }
      return api<ClaimDto>("POST", "/claims", { ...body, submit });
    },
    onSuccess: (claim) => {
      void qc.invalidateQueries({ queryKey: claimKeys.all });
      toast.success(claim.status === "submitted" ? `Claim ${claim.claimNumber} sent for approval` : "Draft saved");
      onOpenChange(false);
      onDone?.(claim);
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "fix-fields") {
        setFormError("Some details are missing. Check the highlighted fields.");
        return;
      }
      const kept = errorDetails<{ draftId?: string }>(err)?.draftId;
      if (kept) {
        setDraftId(kept);
        void qc.invalidateQueries({ queryKey: claimKeys.all });
      }
      setErrors(fieldErrors(err));
      const code = errorCode(err);
      setFormError(
        code === "validation_failed" && Object.keys(fieldErrors(err)).length
          ? `${errorMessage(err)}${kept ? " Your draft is saved." : ""}`
          : `${errorMessage(err)}${kept ? " Your draft is saved." : ""}`,
      );
    },
  });

  const viewerFiles = viewer ? (lines[viewer.line]?.receipts ?? []) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("flex flex-col p-0", mobile ? "max-h-[94dvh]" : "w-[min(34rem,100vw)]")}
        aria-describedby="claim-sheet-desc"
        data-testid="claim-sheet"
      >
        <div className="border-b border-border px-4 pb-3 pt-4 sm:px-5">
          <SheetTitle className="font-azeret text-base font-semibold">
            {draftId ? "Edit claim" : "New claim"}
          </SheetTitle>
          <SheetDescription id="claim-sheet-desc" className="text-2xs text-primary-300">
            Photo of the receipt first, then the amount, type and date.
          </SheetDescription>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            save.mutate(true);
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {formError ? (
              <Alert variant="danger" className="mb-4" data-testid="claim-form-error">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            {!typesLoading && types.length === 0 ? (
              <Alert className="mb-4">
                <AlertDescription>
                  No claim types are set up for you yet. Ask HR to add them in Settings → Claim types.
                </AlertDescription>
              </Alert>
            ) : null}
            <ol className="flex flex-col gap-5">
              {lines.map((l, i) => (
                <LineEditor
                  key={l.key}
                  index={i}
                  line={l}
                  lineCount={lines.length}
                  types={typesByDate.get(l.expenseDate || today()) ?? types}
                  errors={errors}
                  thisClaimCents={(type) =>
                    lines
                      .filter(
                        (o) =>
                          o.claimTypeId === type.id &&
                          periodKey(type, o.expenseDate) === periodKey(type, l.expenseDate),
                      )
                      .reduce((s, o) => s + (sgdOf(o) ?? 0), 0)
                  }
                  onChange={(patch) => update(l.key, patch)}
                  onFiles={(files) => void addFiles(l.key, files)}
                  onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  onView={(index) => setViewer({ line: i, index })}
                />
              ))}
            </ol>
            <Button
              type="button"
              variant="ghost"
              className="mt-3 w-full border border-dashed border-ink/20"
              onClick={() =>
                setLines((ls) => [...ls, emptyLine({ expenseDate: ls[ls.length - 1]?.expenseDate ?? today() })])
              }
              disabled={lines.length >= 30}
            >
              <Plus aria-hidden /> Add another expense
            </Button>
          </div>
          <div className="flex items-center gap-2 border-t border-border bg-surface-50 px-4 py-3 sm:px-5">
            <div className="mr-auto min-w-0">
              <p className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">Total</p>
              <p className="num text-base font-semibold" data-testid="claim-total">
                {formatMoney(total)}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => {
                setFormError(null);
                save.mutate(false);
              }}
            >
              Save draft
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending} data-testid="submit-claim">
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Submit
            </Button>
          </div>
        </form>
        <ReceiptViewer
          files={viewerFiles}
          index={viewer?.index ?? null}
          onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
          onClose={() => setViewer(null)}
        />
      </SheetContent>
    </Sheet>
  );
}

function LineEditor({
  index: i,
  line: l,
  lineCount,
  types,
  errors,
  thisClaimCents,
  onChange,
  onFiles,
  onRemove,
  onView,
}: {
  index: number;
  line: FormLine;
  lineCount: number;
  types: EligibleClaimTypeDto[];
  errors: Record<string, string>;
  thisClaimCents: (type: EligibleClaimTypeDto) => number;
  onChange: (patch: Partial<FormLine>) => void;
  onFiles: (files: FileList | null) => void;
  onRemove: () => void;
  onView: (index: number) => void;
}) {
  const camera = React.useRef<HTMLInputElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const type = types.find((t) => t.id === l.claimTypeId);
  const sgd = sgdOf(l);
  const err = (f: string) => errors[`lines.${i}.${f}`];
  const id = (f: string) => `line-${l.key}-${f}`;
  return (
    <li className="flex flex-col gap-3" data-testid={`claim-line-${i}`}>
      <div className="flex items-center justify-between">
        <p className="font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300">
          {lineCount > 1 ? `Expense ${i + 1}` : "Expense"}
        </p>
        {lineCount > 1 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove expense ${i + 1}`}>
            <Trash2 aria-hidden /> Remove
          </Button>
        ) : null}
      </div>

      {/* Receipt first: the camera on phones, a file picker everywhere. */}
      <div>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid={`receipt-camera-${i}`}
          onChange={(e) => {
            onFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,application/pdf"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid={`receipt-file-${i}`}
          onChange={(e) => {
            onFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        {l.receipts.length ? (
          <div className="mb-2 flex flex-col gap-2">
            {l.receipts.map((r, ri) => (
              <ReceiptChip
                key={r.id}
                file={r}
                onOpen={() => onView(ri)}
                onRemove={() => onChange({ receipts: l.receipts.filter((x) => x.id !== r.id) })}
              />
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button
            type="button"
            variant={l.receipts.length ? "secondary" : "ink"}
            size="lg"
            className="w-full"
            onClick={() => camera.current?.click()}
            disabled={l.receipts.length >= 5}
          >
            {l.uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
            {l.uploading ? "Uploading…" : l.receipts.length ? "Add another photo" : "Snap receipt"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => picker.current?.click()}
            disabled={l.receipts.length >= 5}
            aria-label="Choose a file"
          >
            <Paperclip aria-hidden />
            <span className="hidden sm:inline">Choose file</span>
          </Button>
        </div>
        <p className={cn("mt-1 text-2xs", err("receiptIds") ? "text-danger-300" : "text-primary-200")}>
          {err("receiptIds") ?? (type ? type.receiptHint : "Photo or PDF, up to 10 MB.")}
        </p>
      </div>

      {/* Amount */}
      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
        <div>
          <Label htmlFor={id("currency")} className="mb-1 block text-2xs">
            Currency
          </Label>
          <Select
            value={l.currency}
            onValueChange={(currency) =>
              onChange({ currency, rate: currency === "SGD" ? "" : l.rate, showGst: currency === "SGD" && l.showGst })
            }
          >
            <SelectTrigger id={id("currency")} className="num" aria-label="Currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  <span className="num">{c.code}</span> <span className="text-primary-200">{c.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={id("amount")} className="mb-1 block text-2xs">
            Amount
          </Label>
          <Input
            id={id("amount")}
            inputMode="decimal"
            autoComplete="off"
            placeholder={exponentOf(l.currency) === 0 ? "5000" : "0.00"}
            className="num h-10 text-right text-base"
            value={l.amountText}
            onChange={(e) => onChange({ amountText: e.target.value })}
            aria-invalid={!!err("amountMinor")}
            aria-describedby={err("amountMinor") ? id("amount-err") : undefined}
          />
          {err("amountMinor") ? (
            <p id={id("amount-err")} className="mt-1 text-2xs text-danger-300">
              {err("amountMinor")}
            </p>
          ) : null}
        </div>
      </div>
      {l.currency !== "SGD" ? (
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <div>
            <Label htmlFor={id("rate")} className="mb-1 block text-2xs">
              Rate: SGD per 1 {l.currency}
            </Label>
            <Input
              id={id("rate")}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.301234"
              className="num"
              value={l.rate}
              onChange={(e) => onChange({ rate: e.target.value })}
              aria-invalid={!!err("rate")}
            />
          </div>
          <p className="num pb-2 text-ui" data-testid="sgd-preview">
            = {sgd === null ? "S$—" : formatMoney(sgd)}
          </p>
          {err("rate") ? <p className="col-span-2 text-2xs text-danger-300">{err("rate")}</p> : null}
          <p className="col-span-2 text-2xs text-primary-200">
            Use the rate on your card statement. Rounded half-up to the cent.
          </p>
        </div>
      ) : null}

      {/* Type: one tap. */}
      <fieldset>
        <legend className="mb-1 text-2xs font-medium">What was it for?</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Claim type">
          {types.map((t) => {
            const selected = t.id === l.claimTypeId;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a chip group reads better than radio inputs here; role + aria-checked make it accessible.
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ claimTypeId: t.id, showGst: l.showGst && t.gstApplicable })}
                className={cn(
                  "focus-ring h-9 rounded-md border px-3 text-ui transition-colors",
                  selected
                    ? "border-ink bg-kuning-200 font-medium text-ink"
                    : "border-ink/15 bg-surface-50 text-primary-400 hover:border-ink/40",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        {err("claimTypeId") ? <p className="mt-1 text-2xs text-danger-300">{err("claimTypeId")}</p> : null}
        {type?.cap ? (
          <div className="mt-1.5">
            <CapRemaining cap={type.cap} thisClaimCents={thisClaimCents(type)} />
          </div>
        ) : null}
      </fieldset>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={id("date")} className="mb-1 block text-2xs">
            Date
          </Label>
          <Input
            id={id("date")}
            type="date"
            className="num"
            max={today()}
            value={l.expenseDate}
            onChange={(e) => onChange({ expenseDate: e.target.value })}
            aria-invalid={!!err("expenseDate")}
          />
        </div>
        <div>
          <Label htmlFor={id("merchant")} className="mb-1 block text-2xs">
            Merchant
          </Label>
          <Input
            id={id("merchant")}
            placeholder="Grab, Kopitiam…"
            value={l.merchant}
            maxLength={100}
            onChange={(e) => onChange({ merchant: e.target.value })}
            aria-invalid={!!err("merchant")}
          />
        </div>
        {err("expenseDate") ? <p className="col-span-2 text-2xs text-danger-300">{err("expenseDate")}</p> : null}
        {err("merchant") ? <p className="col-span-2 text-2xs text-danger-300">{err("merchant")}</p> : null}
      </div>
      <div>
        <Label htmlFor={id("description")} className="mb-1 block text-2xs">
          Description
        </Label>
        <Input
          id={id("description")}
          placeholder="Taxi to client meeting at Raffles Place"
          value={l.description}
          maxLength={200}
          onChange={(e) => onChange({ description: e.target.value })}
          aria-invalid={!!err("description")}
        />
        {err("description") ? <p className="mt-1 text-2xs text-danger-300">{err("description")}</p> : null}
      </div>
      {l.currency === "SGD" && (type?.gstApplicable ?? true) ? (
        l.showGst ? (
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <Label htmlFor={id("gst")} className="mb-1 block text-2xs">
                GST included (S$)
              </Label>
              <Input
                id={id("gst")}
                inputMode="decimal"
                className="num text-right"
                placeholder="0.00"
                value={l.gstText}
                onChange={(e) => onChange({ gstText: e.target.value })}
                aria-invalid={!!err("gstCents")}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ showGst: false, gstText: "" })}>
              No GST
            </Button>
            {err("gstCents") ? <p className="col-span-2 text-2xs text-danger-300">{err("gstCents")}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            className="focus-ring w-fit rounded-sm text-2xs font-medium text-biru-400 hover:underline"
            onClick={() => onChange({ showGst: true })}
          >
            Add GST from a tax invoice
          </button>
        )
      ) : null}
    </li>
  );
}
