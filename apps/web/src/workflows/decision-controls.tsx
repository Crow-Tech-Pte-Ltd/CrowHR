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
    if (!text) return setError("Say why, so the requester knows what to change.");
    if (text.length > MAX) return setError(`Shorten this to ${MAX} characters or fewer.`);
    onConfirm(text);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {count > 1 ? `Reject ${count} requests` : `Reject ${who ? `${who}'s request` : "request"}`}
            </DialogTitle>
            <DialogDescription>
              {count > 1 ? "Every requester sees this comment." : "The requester sees this comment."} Say what would
              need to change.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Reason" error={error} hint={`${comment.trim().length}/${MAX}`}>
            <Textarea
              autoFocus
              rows={4}
              value={comment}
              maxLength={MAX + 50}
              onChange={(e) => {
                setComment(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Clashes with the year-end stocktake on 4 Nov. Could you move it a week?"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              Reject
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
}: {
  who: string;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex shrink-0 justify-end gap-1">
      {/* Named "Reject" where there is room: a bare ✕ beside Approve reads as "close". */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Reject ${who}'s request`}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
          >
            <X />
            {compact ? null : <span className="hidden sm:inline">Reject</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reject (needs a reason)</TooltipContent>
      </Tooltip>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Approve ${who}'s request`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onApprove();
        }}
      >
        <Check />
        {compact ? null : "Approve"}
      </Button>
    </div>
  );
}

export function DuePill({ dueOn, today, short }: { dueOn: string | null; today: string; short?: boolean }) {
  const due = dueLabel(dueOn, today, { short });
  if (!due) return null;
  return (
    <StatusPill tone={due.tone} dot={due.tone !== "neutral"}>
      <span className="num normal-case">{due.text}</span>
    </StatusPill>
  );
}

export function OriginBadge({ origin, onBehalfOf }: { origin: TaskOrigin; onBehalfOf?: string | null }) {
  const label = ORIGIN_LABEL[origin];
  if (!label) return null;
  return (
    <StatusPill tone={origin === "escalated" ? "warning" : "info"} dot={false}>
      <span className="normal-case">{origin === "delegated" && onBehalfOf ? `Covering for ${onBehalfOf}` : label}</span>
    </StatusPill>
  );
}
