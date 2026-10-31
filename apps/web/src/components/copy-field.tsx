import { Button, Input, toast } from "@crowhr/ui";
import { Check, Copy } from "lucide-react";
import * as React from "react";

/** A read-only value with a copy button (invitation and reset links, callback URLs). */
export function CopyField({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy automatically. Select the text and copy it.");
    }
  };
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="num text-2xs"
        data-testid={testId}
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button type="button" variant="secondary" size="icon" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
