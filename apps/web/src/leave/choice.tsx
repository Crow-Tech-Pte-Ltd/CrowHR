import { Checkbox, RadioGroupItem, Switch } from "@crowhr/ui";
import * as React from "react";

/** A control (switch, checkbox or radio) with a clickable label wired by id. */
function Row({ control, children }: { control: (id: string) => React.ReactNode; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2 text-ui">
      {control(id)}
      <label htmlFor={id} className="cursor-pointer">
        {children}
      </label>
    </div>
  );
}

export function SwitchRow({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Row control={(id) => <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />}>
      {children}
    </Row>
  );
}

export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Row control={(id) => <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />}>
      {children}
    </Row>
  );
}

export function RadioRow({ value, children }: { value: string; children: React.ReactNode }) {
  return <Row control={(id) => <RadioGroupItem id={id} value={value} />}>{children}</Row>;
}
