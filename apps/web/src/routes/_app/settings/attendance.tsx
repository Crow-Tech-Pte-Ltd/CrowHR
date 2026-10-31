import { Button, Card, FormField, Input, RadioGroup, Skeleton, Textarea, toast } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { type AttendanceSettings, attKeys, settingsQuery } from "../../../attendance/api.ts";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { RadioRow } from "../../../leave/choice.tsx";
import { ApiError, apiPut } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/settings/attendance")({
  component: AttendanceSettingsPage,
});

interface OfficeDraft {
  key: string;
  id?: string;
  name: string;
  latitude: string;
  longitude: string;
  radiusMetres: string;
}

let seq = 0;

function AttendanceSettingsPage() {
  const me = useMe();
  const q = useQuery(settingsQuery);
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Attendance"
        description="How clocking in works: location and network checks, the working day, lateness and overtime rounding."
      />
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-64 w-full max-w-3xl" />
      ) : (
        <SettingsForm initial={q.data} editable={can(me, "policies:update")} />
      )}
    </>
  );
}

function SettingsForm({ initial, editable }: { initial: AttendanceSettings; editable: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = React.useState<AttendanceSettings>(initial);
  const [offices, setOffices] = React.useState<OfficeDraft[]>(() =>
    initial.offices.map((o) => ({
      key: `o${++seq}`,
      id: o.id,
      name: o.name,
      latitude: String(o.latitude),
      longitude: String(o.longitude),
      radiusMetres: String(o.radiusMetres),
    })),
  );
  const [ips, setIps] = React.useState(initial.allowedIps.join("\n"));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const { effectivePdpaNotice: _e, ...rest } = s;
      return apiPut<AttendanceSettings>("/api/v1/attendance/settings", {
        ...rest,
        pdpaNotice: s.pdpaNotice?.trim() || null,
        offices: offices.map((o) => ({
          ...(o.id ? { id: o.id } : {}),
          name: o.name.trim(),
          latitude: Number(o.latitude),
          longitude: Number(o.longitude),
          radiusMetres: Number(o.radiusMetres),
        })),
        allowedIps: ips
          .split(/[\n,]/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
    },
    onSuccess: (r) => {
      setS(r);
      setErrors({});
      void qc.invalidateQueries({ queryKey: attKeys.all });
      toast.success("Attendance settings saved.");
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(err instanceof Error ? err.message : "That didn't save.");
    },
  });
  const num = (k: keyof AttendanceSettings) => ({
    className: "num w-24",
    inputMode: "numeric" as const,
    disabled: !editable,
    value: String(s[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setS({ ...s, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 }),
  });
  return (
    <form
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="font-azeret text-xs font-semibold">Location</h2>
          <p className="mt-1 text-ui text-primary-300">
            Off by default. When on, the phone's location is stored with each punch and staff see your PDPA notice
            first.
          </p>
        </div>
        <RadioGroup
          disabled={!editable}
          value={s.locationMode}
          onValueChange={(v) => setS({ ...s, locationMode: v as AttendanceSettings["locationMode"] })}
          className="flex flex-col gap-2"
        >
          <RadioRow value="off">Don't collect location</RadioRow>
          <RadioRow value="optional">Collect it when the device allows</RadioRow>
          <RadioRow value="required">Require it for every punch</RadioRow>
        </RadioGroup>
        {errors.locationMode ? <p className="text-2xs text-danger-300">{errors.locationMode}</p> : null}
        {s.locationMode !== "off" ? (
          <>
            <FormField label="PDPA notice" hint="Leave blank to use the standard notice below.">
              <Textarea
                rows={3}
                disabled={!editable}
                value={s.pdpaNotice ?? ""}
                placeholder={initial.effectivePdpaNotice}
                onChange={(e) => setS({ ...s, pdpaNotice: e.target.value })}
              />
            </FormField>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-azeret text-2xs font-semibold uppercase tracking-wider">Offices</legend>
              {offices.length === 0 ? (
                <p className="text-ui text-primary-300">No offices: location is stored but not checked.</p>
              ) : null}
              {offices.map((o, i) => (
                <div key={o.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_6rem_auto]">
                  <Input
                    aria-label={`Office ${i + 1} name`}
                    placeholder="Tanjong Pagar outlet"
                    value={o.name}
                    disabled={!editable}
                    onChange={(e) =>
                      setOffices(offices.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <Input
                    aria-label={`Office ${i + 1} latitude`}
                    className="num"
                    placeholder="1.2764"
                    value={o.latitude}
                    disabled={!editable}
                    onChange={(e) =>
                      setOffices(offices.map((x) => (x.key === o.key ? { ...x, latitude: e.target.value } : x)))
                    }
                  />
                  <Input
                    aria-label={`Office ${i + 1} longitude`}
                    className="num"
                    placeholder="103.8457"
                    value={o.longitude}
                    disabled={!editable}
                    onChange={(e) =>
                      setOffices(offices.map((x) => (x.key === o.key ? { ...x, longitude: e.target.value } : x)))
                    }
                  />
                  <Input
                    aria-label={`Office ${i + 1} radius in metres`}
                    className="num"
                    placeholder="200"
                    value={o.radiusMetres}
                    disabled={!editable}
                    onChange={(e) =>
                      setOffices(offices.map((x) => (x.key === o.key ? { ...x, radiusMetres: e.target.value } : x)))
                    }
                  />
                  {editable ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove office ${i + 1}`}
                      onClick={() => setOffices(offices.filter((x) => x.key !== o.key))}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              ))}
              {errors.offices || Object.keys(errors).some((k) => k.startsWith("offices.")) ? (
                <p className="text-2xs text-danger-300">
                  {errors.offices ?? Object.entries(errors).find(([k]) => k.startsWith("offices."))?.[1]}
                </p>
              ) : null}
              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() =>
                    setOffices([
                      ...offices,
                      { key: `o${++seq}`, name: "", latitude: "", longitude: "", radiusMetres: "200" },
                    ])
                  }
                >
                  <Plus /> Add office (name, latitude, longitude, radius m)
                </Button>
              ) : null}
            </fieldset>
            <FormField label="Outside every office">
              <RadioGroup
                disabled={!editable}
                value={s.locationEnforcement}
                onValueChange={(v) => setS({ ...s, locationEnforcement: v as "flag" | "block" })}
                className="flex gap-4"
              >
                <RadioRow value="flag">Record and flag it</RadioRow>
                <RadioRow value="block">Refuse the punch</RadioRow>
              </RadioGroup>
            </FormField>
          </>
        ) : null}
      </Card>
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="font-azeret text-xs font-semibold">Office network</h2>
          <p className="mt-1 text-ui text-primary-300">
            Optional. Only accept punches from these IP addresses or ranges, one per line. Leave empty for any network.
          </p>
        </div>
        <FormField
          label="Allowed IP ranges"
          error={errors.allowedIps ?? Object.entries(errors).find(([k]) => k.startsWith("allowedIps."))?.[1]}
        >
          <Textarea
            rows={3}
            className="num"
            disabled={!editable}
            value={ips}
            placeholder="203.0.113.0/24"
            onChange={(e) => setIps(e.target.value)}
          />
        </FormField>
        <FormField label="From another network">
          <RadioGroup
            disabled={!editable}
            value={s.ipEnforcement}
            onValueChange={(v) => setS({ ...s, ipEnforcement: v as "flag" | "block" })}
            className="flex gap-4"
          >
            <RadioRow value="flag">Record and flag it</RadioRow>
            <RadioRow value="block">Refuse the punch</RadioRow>
          </RadioGroup>
        </FormField>
      </Card>
      <Card className="flex flex-col gap-4 p-4">
        <h2 className="font-azeret text-xs font-semibold">Working day and overtime</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Usual start (SGT)" error={errors.defaultStartTime}>
            <Input
              type="time"
              className="num w-32"
              disabled={!editable}
              value={s.defaultStartTime}
              onChange={(e) => setS({ ...s, defaultStartTime: e.target.value })}
            />
          </FormField>
          <FormField label="Unpaid break (min)" hint="Taken off days over 6 hours.">
            <Input {...num("breakMinutes")} />
          </FormField>
          <FormField label="Clock skew allowed (s)" hint="Device clock error before flagging.">
            <Input {...num("skewThresholdSeconds")} />
          </FormField>
          <FormField label="Late after (min)" hint="Grace after the start.">
            <Input {...num("lateGraceMinutes")} />
          </FormField>
          <FormField label="Early out grace (min)">
            <Input {...num("earlyOutGraceMinutes")} />
          </FormField>
          <div />
          <FormField label="OT in blocks of (min)" hint="Rounded down.">
            <Input {...num("otBlockMinutes")} />
          </FormField>
          <FormField label="Minimum OT (min)" hint="Less than this isn't OT.">
            <Input {...num("otMinimumMinutes")} />
          </FormField>
        </div>
      </Card>
      {editable ? (
        <Button type="submit" variant="primary" className="self-start" disabled={save.isPending}>
          Save attendance settings
        </Button>
      ) : null}
    </form>
  );
}
