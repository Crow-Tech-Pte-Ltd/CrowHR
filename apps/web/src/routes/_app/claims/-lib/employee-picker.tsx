import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import * as React from "react";
import { directoryQuery } from "../../people/-lib/api.ts";

export interface PickedEmployee {
  id: string;
  name: string;
  employeeNumber: string;
}

/**
 * Who a claim is for (owners and HR admins filing on behalf): a searchable list of current
 * employees, by name or employee number. "Me" first when the member has an employee record. The
 * server decides whether the member may claim for the employee; this only offers the choice.
 */
export function EmployeePicker({
  id,
  value,
  onChange,
  me,
  disabled,
  required,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  id?: string;
  /** The chosen employee, or null for "me". */
  value: PickedEmployee | null;
  onChange: (employee: PickedEmployee | null) => void;
  /** The member's own employee record, offered as "Me"; null when the account isn't linked. */
  me: { id: string } | null;
  disabled?: boolean;
  /** Set by FormField. */
  required?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const people = useQuery({ ...directoryQuery({ status: "active,leaving" }), enabled: open, staleTime: 5 * 60_000 });
  const others = (people.data?.items ?? []).filter((p) => p.id !== me?.id);
  const pick = (employee: PickedEmployee | null) => {
    onChange(employee);
    setOpen(false);
  };
  const label = value ? value.name : me ? "Me" : "Choose an employee";
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && !me && "text-primary-300")}
          data-testid="claim-employee"
        >
          <span className="truncate">
            {label}
            {value ? <span className="num text-primary-200"> {value.employeeNumber}</span> : null}
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(var(--radix-popover-trigger-width),92vw)] p-0"
        aria-label="Choose who the claim is for"
      >
        <Command loop>
          <CommandInput placeholder="Name or employee number" aria-label="Search employees" />
          <CommandList aria-label="Employees">
            {people.isPending ? (
              <p className="flex items-center justify-center gap-2 px-3 py-6 text-ui text-primary-200" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading employees…
              </p>
            ) : people.isError ? (
              <p className="px-3 py-6 text-center text-ui text-danger-300" role="alert">
                Couldn't load employees. Close this list and open it again.
              </p>
            ) : (
              <>
                <CommandEmpty>No employee matches. Check the spelling, or search by employee number.</CommandEmpty>
                {me ? (
                  <CommandGroup>
                    <CommandItem value="me" keywords={["me", "myself"]} onSelect={() => pick(null)}>
                      <Check className={cn(value ? "opacity-0" : "opacity-100")} aria-hidden />
                      Me
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandGroup heading="Employees">
                  {others.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      keywords={[p.name, p.legalName, p.employeeNumber]}
                      onSelect={() => pick({ id: p.id, name: p.name, employeeNumber: p.employeeNumber })}
                    >
                      <Check className={cn(value?.id === p.id ? "opacity-100" : "opacity-0")} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="num shrink-0 text-2xs text-primary-300">{p.employeeNumber}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
