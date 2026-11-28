import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  StatusPill,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@crowhr/ui";
import { Check, X } from "lucide-react";
import * as React from "react";
import { useT } from "../i18n/index.ts";
import { ORIGIN_LABEL, type TaskOrigin } from "./api.ts";
import { dueLabel } from "./format.ts";

const MAX = 500;

/** Rejection always needs a comment (1–500 characters); the requester sees it. */
export function RejectDialog({
  open,
  onOpenChange,
  count,
  who,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  who?: string;
  onConfirm: (comment: string) => void;
  pending?: boolean;
}) {
  const tWorkflow = useT("workflows");
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setComment("");
      setError(null);
    }
  }, [open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = comment.trim();
    if (!text) return setError(tWorkflow("Say why, so the requester knows what to change."));
    if (text.length > MAX) return setError(tWorkflow("Shorten this to {arg1} characters or fewer.", { arg1: MAX }));
    onConfirm(text);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {count > 1
                ? tWorkflow("Reject {arg1} requests", { arg1: count })
                : tWorkflow("Reject {arg1}", { arg1: who ? `${who}'s request` : "request" })}
            </DialogTitle>
            <DialogDescription>
              {count > 1
                ? tWorkflow("Every requester sees this comment.")
                : tWorkflow("The requester sees this comment.")}{" "}
              {tWorkflow("Say what would need to change.")}
            </DialogDescription>
          </DialogHeader>
          <FormField label={tWorkflow("Reason")} error={error} hint={`${comment.trim().length}/${MAX}`}>
            <Textarea
              autoFocus
              rows={4}
              value={comment}
              maxLength={MAX + 50}
              onChange={(e) => {
                setComment(e.target.value);
                setError(null);
              }}
              placeholder={tWorkflow("e.g. Clashes with the year-end stocktake on 4 Nov. Could you move it a week?")}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tWorkflow("Cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {tWorkflow("Reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve (secondary) + reject (icon) used on Home rows and in the inbox. */
export function DecisionButtons({
  who,
  onApprove,
  onReject,
  disabled,
  compact,
  labelled,
}: {
  who: string;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** Spell out "Reject" at every width (the caller gave the buttons a line of their own). */
  labelled?: boolean;
}) {
  const tWorkflow = useT("workflows");
  return (
    <div className="flex shrink-0 justify-end gap-1">
      {/* Named "Reject" where there is room: a bare ✕ beside Approve reads as "close". */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={tWorkflow("Reject {arg1}'s request", { arg1: who })}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
          >
            <X />
            {compact ? null : <span className={labelled ? undefined : "hidden sm:inline"}>{tWorkflow("Reject")}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tWorkflow("Reject (needs a reason)")}</TooltipContent>
      </Tooltip>
      <Button
        size="sm"
        variant="secondary"
        aria-label={tWorkflow("Approve {arg1}'s request", { arg1: who })}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onApprove();
        }}
      >
        <Check />
        {compact ? null : tWorkflow("Approve")}
      </Button>
    </div>
  );
}

/** A chip only when the date needs attention (overdue, today, tomorrow); a later due date is plain text. */
export function DuePill({ dueOn, today, short }: { dueOn: string | null; today: string; short?: boolean }) {
  const tWorkflow = useT("workflows");
  const due = dueLabel(dueOn, today, { short, t: tWorkflow });
  if (!due) return null;
  if (due.tone === "neutral")
    return <span className="num whitespace-nowrap text-2xs text-primary-300">{due.text}</span>;
  return (
    <StatusPill tone={due.tone}>
      <span className="num">{due.text}</span>
    </StatusPill>
  );
}

export function OriginBadge({ origin, onBehalfOf }: { origin: TaskOrigin; onBehalfOf?: string | null }) {
  const tWorkflow = useT("workflows");
  const label = ORIGIN_LABEL[origin];
  if (!label) return null;
  return (
    <StatusPill tone={origin === "escalated" ? "warning" : "info"}>
      {origin === "delegated" && onBehalfOf ? tWorkflow("Covering for {arg1}", { arg1: onBehalfOf }) : tWorkflow(label)}
    </StatusPill>
  );
}
